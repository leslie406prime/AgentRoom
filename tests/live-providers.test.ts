// Real network tests against Gemini and Groq. Skipped unless RUN_LIVE_AI_TESTS=true AND the provider key is present.
// Run with: npm run test:live  (each test sends one tiny request and uses a little free-tier quota).
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "socket.io";
import { loadEnvConfig } from "@next/env";
// Next.js deliberately omits .env.local under NODE_ENV=test. Only this explicitly
// opted-in live suite loads the application's development environment, then restores test mode.
if (process.env.RUN_LIVE_AI_TESTS === "true") {
  const environment: Record<string, string | undefined> = process.env;
  const previous = environment.NODE_ENV;
  try { environment.NODE_ENV = "development"; loadEnvConfig(process.cwd(), true, undefined, true); }
  finally { if (previous === undefined) delete environment.NODE_ENV; else environment.NODE_ENV = previous; }
  console.info("Live provider key presence:", { gemini: Boolean(process.env.GEMINI_API_KEY?.trim()), groq: Boolean(process.env.GROQ_API_KEY?.trim()) });
}
import { streamWithRecovery, verifyProvider, providerKey } from "../src/server/ai-providers";
import { catalog, defaultModelKey, parseModelKey } from "../src/lib/ai-catalog";
const live = process.env.RUN_LIVE_AI_TESTS === "true";
async function collect(provider: "gemini" | "groq", model: string) {
  let text = "", usage: { input: number; output: number } | undefined;
  for await (const event of streamWithRecovery(provider, { apiKey: providerKey(provider)!, model, system: "Reply with exactly one short word.", user: "Say OK.", maxOutputTokens: 256 })) { if ("text" in event) text += event.text; else if ("usage" in event) usage = event.usage; }
  return { text, usage };
}
describe.skipIf(!live || !process.env.GEMINI_API_KEY)("live Gemini", () => {
  it("lists accessible models and streams a real response with usage", async () => {
    const listing = await verifyProvider("gemini", true); expect(listing.ok).toBe(true);
    console.info("Gemini catalog models accessible:", catalog.filter((m) => m.provider === "gemini").map((m) => `${m.id}=${listing.ok && listing.ids.includes(m.id)}`).join(", "));
    const model = catalog.find((m) => m.provider === "gemini" && m.id === parseModelKey(defaultModelKey)?.id && listing.ok && listing.ids.includes(m.id)); expect(model).toBeTruthy();
    const { text, usage } = await collect("gemini", model!.id); expect(text.trim().length).toBeGreaterThan(0); expect(usage?.input).toBeGreaterThan(0);
  }, 60_000);
});
describe.skipIf(!live || !process.env.GROQ_API_KEY)("live Groq", () => {
  it("lists accessible models and runs Muse through the real queue with persisted output and usage", async () => {
    const listing = await verifyProvider("groq", true); expect(listing.ok).toBe(true);
    console.info("Groq catalog models accessible:", catalog.filter((m) => m.provider === "groq").map((m) => `${m.id}=${listing.ok && listing.ids.includes(m.id)}`).join(", "));
    // Probe a documented free-plan model; model-list visibility alone does not prove Llama's billing eligibility.
    const model = catalog.find((m) => m.provider === "groq" && m.id === "openai/gpt-oss-20b" && listing.ok && listing.ids.includes(m.id)); expect(model).toBeTruthy();
    const { db } = await import("../src/server/db");
    const { createWorkspace } = await import("../src/server/workspace-repository");
    const { joinMember, sendChannelMessage, enqueueChannelAgent, channelSnapshot } = await import("../src/server/collaboration-repository");
    const { updateAIConfig } = await import("../src/server/ai-workspace");
    const { getAISettings } = await import("../src/server/ai-repository");
    const { ensureWorker } = await import("../src/server/queue");
    const { runAgent } = await import("../src/server/agent-worker");
    const actor = randomUUID();
    db.prepare('INSERT INTO "user"(id,name,created_at) VALUES (?,?,?)').run(actor, "Live tester", Date.now());
    const workspace = createWorkspace(actor, { name: "Isolated live Muse verification" });
    joinMember(actor, workspace.id, workspace.channelId);
    const modelKey = `groq:${model!.id}`;
    updateAIConfig(actor, workspace.id, { enabledProviders: ["groq"], approvedModels: [modelKey], defaultModel: modelKey, museModel: modelKey, allowPaid: false, userHourlyLimit: 2, workspaceDailyLimit: 2 });
    sendChannelMessage(actor, workspace.id, workspace.channelId, { clientId: randomUUID(), content: "Decision: the release code is AR-MUSE-42." });
    const job = enqueueChannelAgent(actor, workspace.id, workspace.channelId, { agent: "muse", prompt: "What is the release code we decided? Reply with only the code.", idempotencyKey: randomUUID() }).result.job;
    let streamed = false;
    const io = { to: () => ({ emit: (event: string) => { if (event === "agent:token") streamed = true; } }) } as unknown as Server;
    ensureWorker(io, workspace.channelId, runAgent);
    await vi.waitFor(() => {
      const row = db.prepare("SELECT status,error FROM agent_jobs WHERE id=?").get(job.id) as { status: string; error: string | null };
      if (row.status === "failed") throw new Error(row.error ?? "Live Muse job failed");
      expect(row.status).toBe("completed");
    }, { timeout: 60_000 });
    const reply = (channelSnapshot(actor, workspace.id, workspace.channelId).messages as { kind: string; content: string; agent: string; provider: string; model: string }[]).find((message) => message.kind === "agent");
    expect(reply).toMatchObject({ agent: "muse", provider: "groq", model: model!.id });
    expect(reply?.content).toContain("AR-MUSE-42"); expect(streamed).toBe(true);
    expect(getAISettings(actor, workspace.id).usage.tokens).toBeGreaterThan(0);
    console.info("Live Muse verified:", { provider: "groq", model: model!.id, persisted: true, channelFactMatched: true, tokenUsageRecorded: true, paidAuthorized: false });
  }, 90_000);
});
