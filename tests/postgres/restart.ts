// Runs in two separate application processes against a disposable local cluster.
import "./local-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db, initializeDatabase } from "../../src/server/db";
import { authAdapter } from "../../src/server/auth-adapter";
import { createWorkspace } from "../../src/server/workspace-repository";
import { createChannel } from "../../src/server/channel-repository";
import { joinMember, sendChannelMessage, saveChannelArtifact, channelSnapshot, enqueueChannelAgent, queuedChannels, persistAgentResponse } from "../../src/server/collaboration-repository";
import { claimNextJob, recoverJobs, ensureWorker, drainWorkers } from "../../src/server/queue";
import type { Server } from "socket.io";

type Fixture = { user: string; workspace: string; channel: string; session: string; expired: string; queued: string[]; live: string; snapshot: Awaited<ReturnType<typeof channelSnapshot>> };
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  assert(process.env.AGENTROOM_POSTGRES_TEST === "true" && url.hostname === "127.0.0.1" && url.pathname === "/agentroom_test");
  const file = process.env.AGENTROOM_RESTART_FIXTURE!;
  assert(file);
  await initializeDatabase();
  if (process.argv[2] === "seed") {
    const user = await authAdapter.createUser!({ id: randomUUID(), email: "restart@example.test", name: "Restart owner", emailVerified: new Date() });
    await authAdapter.linkAccount!({ userId: user.id, type: "oauth", provider: "google", providerAccountId: "restart-google" });
    const session = randomUUID();
    await authAdapter.createSession!({ sessionToken: session, userId: user.id, expires: new Date(Date.now() + 3600000) });
    const w = await createWorkspace(user.id, { name: "Restart persistence" });
    const channel = await createChannel(user.id, w.id, { name: "Durable channel" });
    await joinMember(user.id, w.id, channel.id);
    await sendChannelMessage(user.id, w.id, channel.id, { clientId: randomUUID(), content: "Message survives restart" });
    await saveChannelArtifact(user.id, w.id, channel.id, { title: "Restart artifact", type: "document", language: "markdown", content: "Artifact survives restart", version: 0 });
    const enqueue = async (channelId: string, prompt: string) => (await enqueueChannelAgent(user.id, w.id, channelId, { agent: "agent", prompt, idempotencyKey: randomUUID() })).result.job.id;
    const expired = await enqueue(channel.id, "Interrupted request");
    await claimNextJob(channel.id);
    // Simulate an expired previous worker without waiting for the 90-second lease.
    await db.prepare("UPDATE agent_jobs SET lease_expires_at=0 WHERE id=?").run(expired);
    const queued = [await enqueue(channel.id, "First queued"), await enqueue(channel.id, "Second queued")];
    await joinMember(user.id, w.id, w.channelId);
    const live = await enqueue(w.channelId, "Other live worker");
    await claimNextJob(w.channelId);
    await db.prepare("UPDATE agent_jobs SET worker_id=?,lease_expires_at=? WHERE id=?").run("other-live-worker", Date.now() + 3600000, live);
    const fixture: Fixture = { user: user.id, workspace: w.id, channel: channel.id, session, expired, queued, live, snapshot: await channelSnapshot(user.id, w.id, channel.id) };
    await writeFile(file, JSON.stringify(fixture));
    console.info("Restart fixture saved through application repositories.");
  } else {
    const f = JSON.parse(await readFile(file, "utf8")) as Fixture;
    assert.equal((await authAdapter.getUserByAccount!({ provider: "google", providerAccountId: "restart-google" }))!.id, f.user);
    assert.equal((await authAdapter.getSessionAndUser!(f.session))!.user.id, f.user);
    assert.deepEqual(await channelSnapshot(f.user, f.workspace, f.channel), f.snapshot);
    await recoverJobs();
    assert.equal((await db.prepare("SELECT status FROM agent_jobs WHERE id=?").get(f.expired))!.status, "failed");
    assert.equal((await db.prepare("SELECT status FROM agent_jobs WHERE id=?").get(f.live))!.status, "running");
    assert((await queuedChannels()).some(c => c.roomId === f.channel));
    const executed: string[] = [];
    const io = { to: () => ({ emit: () => {} }) } as unknown as Server;
    ensureWorker(io, f.channel, async job => { executed.push(job.id); await persistAgentResponse(job, "Mock restart response", "demo"); });
    const deadline = Date.now() + 15000;
    while ((await db.prepare("SELECT count(*) AS n FROM agent_jobs WHERE room_id=? AND status='completed'").get(f.channel))!.n !== 2) {
      assert(Date.now() < deadline, "Restarted queue did not finish");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.deepEqual(executed, f.queued);
    assert.equal((await channelSnapshot(f.user, f.workspace, f.channel)).messages.filter(m => m.kind === "agent").length, 2);
    console.info("Fresh application process: identities, sessions, workspace, channel, messages, artifacts, replay and safe FIFO recovery passed.");
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await drainWorkers(); await db.close(); });
