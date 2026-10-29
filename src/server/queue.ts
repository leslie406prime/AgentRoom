import { PublicJobError } from "./job-errors";
import { failUsage } from "./ai-repository";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, emitPersisted } from "./db";
import type { Server } from "socket.io";

export const ArtifactOutput = z.object({
  title: z.string().trim().min(1).max(80),
  type: z.enum(["code", "document"]),
  language: z.string().trim().min(1).max(32),
  content: z.string().max(50000),
});

type Job = { id: string; room_id: string; requester_id: string; requester_name: string; prompt: string; idempotency_key: string; status: string; model?: string | null; agent?: string | null; provider?: string | null };
const running = new Map<string, Promise<void>>();
const QueueInput = z.object({ roomId: z.string().min(12).max(64), memberId: z.string().min(8).max(80), prompt: z.string().trim().min(1).max(4000), idempotencyKey: z.string().min(8).max(100), model: z.string().min(1).max(100).optional(), agent: z.enum(["muse", "gemini", "llama", "agent"]).optional(), provider: z.string().max(20).nullable().optional() });

function publicJob(job: Job, error?: string | null) {
  return {
    id: job.id,
    requesterId: job.requester_id,
    requesterName: job.requester_name,
    prompt: job.prompt,
    status: job.status,
    model: job.model ?? null,
    agent: job.agent ?? null,
    provider: job.provider ?? null,
    error: error ?? null,
  };
}

export function listQueueJobs(roomId: string) {
  return db.prepare("SELECT id, requester_id AS requesterId, requester_name AS requesterName, prompt, status, error, model, agent, provider FROM agent_jobs WHERE room_id = ? AND status IN ('queued', 'running', 'failed') ORDER BY enqueue_order").all(roomId);
}

function broadcastQueue(io: Server, roomId: string) {
  io.to(roomId).emit("queue:update", listQueueJobs(roomId));
}

export function submitJob(input: z.infer<typeof QueueInput>) {
  const parsed = QueueInput.parse(input);
  const result = db.transaction(() => {
    const prior = db.prepare("SELECT * FROM agent_jobs WHERE room_id = ? AND idempotency_key = ?").get(parsed.roomId, parsed.idempotencyKey) as Job | undefined;
    if (prior) return { job: prior, duplicate: true, event: undefined };
    const member = db.prepare("SELECT name FROM members WHERE room_id = ? AND id = ?").get(parsed.roomId, parsed.memberId) as { name: string } | undefined;
    if (!member) throw new Error("You are not a member of this room");
    const counts = db.prepare("SELECT COUNT(*) AS count FROM agent_jobs WHERE room_id = ? AND status IN ('queued', 'running')").get(parsed.roomId) as { count: number };
    if (counts.count >= 20) throw new Error("This room's agent queue is full. Try again shortly.");
    const id = nanoid(16);
    const order=(db.prepare("SELECT COALESCE(MAX(enqueue_order),0)+1 AS n FROM agent_jobs WHERE room_id=?").get(parsed.roomId) as {n:number}).n;
    const now=new Date().toISOString();
    db.prepare("INSERT INTO agent_jobs (id, room_id, requester_id, requester_name, prompt, idempotency_key, status, model, enqueue_order, created_at, updated_at, agent, provider) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)")
      .run(id, parsed.roomId, parsed.memberId, member.name, parsed.prompt, parsed.idempotencyKey, parsed.model ?? null, order, now, now, parsed.agent ?? null, parsed.provider ?? null);
    const job = db.prepare("SELECT * FROM agent_jobs WHERE id = ?").get(id) as Job;
    const event = emitPersisted(parsed.roomId, "job", publicJob(job));
    return { job, duplicate: false, event };
  }).immediate();
  return result;
}

export function claimNextJob(roomId: string, io?: Server): Job | undefined {
  const result = db.transaction(() => {
    const isRunning = db.prepare("SELECT 1 FROM agent_jobs WHERE room_id = ? AND status = 'running'").get(roomId);
    if (isRunning) return undefined;
    const candidate = db.prepare("SELECT * FROM agent_jobs WHERE room_id = ? AND status = 'queued' ORDER BY enqueue_order LIMIT 1").get(roomId) as Job | undefined;
    if (!candidate) return undefined;
    const result = db.prepare("UPDATE agent_jobs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'").run(new Date().toISOString(), candidate.id);
    if (result.changes !== 1) return undefined;
    const claimed = { ...candidate, status: "running" };
    const event = emitPersisted(roomId, "job", publicJob(claimed));
    return { job: claimed, event };
  }).immediate();
  if (result && io) io.to(roomId).emit("room:event", result.event);
  return result?.job;
}

export function updateJob(roomId: string, jobId: string, status: "completed" | "failed" | "cancelled", error?: string, io?: Server) {
  const event = db.transaction(() => {
    const job = db.prepare("SELECT * FROM agent_jobs WHERE room_id = ? AND id = ?").get(roomId, jobId) as Job | undefined;
    if (!job) return undefined;
    db.prepare("UPDATE agent_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(status, error ?? null, new Date().toISOString(), jobId);
    return emitPersisted(roomId, "job", publicJob({ ...job, status }, error));
  }).immediate();
  if (io && event) {
    io.to(roomId).emit("room:event", event);
    broadcastQueue(io, roomId);
  }
}

export function cancelJob(roomId: string, jobId: string, memberId: string, io?: Server) {
  const job = db.prepare("SELECT * FROM agent_jobs WHERE room_id = ? AND id = ?").get(roomId, jobId) as (Job & { error: string | null }) | undefined;
  if (!job || job.requester_id !== memberId) throw new Error("Only the requester can cancel this job");
  if (job.status !== "queued") throw new Error("Only queued jobs can be cancelled");
  updateJob(roomId, jobId, "cancelled", undefined, io);
}

export function recoverJobs() {
  const stuck = db.prepare("SELECT id, room_id FROM agent_jobs WHERE status = 'running'").all() as { id: string; room_id: string }[];
  for (const job of stuck) {
    db.transaction(() => {
      db.prepare("UPDATE agent_jobs SET status = 'queued', updated_at = ? WHERE id = ?").run(new Date().toISOString(), job.id);
      const recovered = db.prepare("SELECT * FROM agent_jobs WHERE id = ?").get(job.id) as Job;
      emitPersisted(job.room_id, "job", publicJob(recovered));
    }).immediate();
  }
}

export function ensureWorker(io: Server, roomId: string, execute: (job: Job, io: Server) => Promise<void>) {
  if (running.has(roomId)) return;
  const loop = (async () => {
    while (true) {
      const job = claimNextJob(roomId, io);
      if (!job) break;
      broadcastQueue(io, roomId);
      io.to(roomId).emit("agent:status", { status: "working", requester: job.requester_name, jobId: job.id });
      try {
        await execute(job, io);
        updateJob(roomId, job.id, "completed", undefined, io);
      } catch (error) {
        failUsage(job.id, error instanceof PublicJobError && error.releaseUsage);
        console.error(JSON.stringify({ level: "error", event: "agent_job_failed", roomId, jobId: job.id, error: "Agent execution failed" }));
        updateJob(roomId, job.id, "failed", error instanceof PublicJobError ? error.message : "The agent couldn't complete this request. Please retry.", io);
        io.to(roomId).emit("agent:done", { jobId: job.id });
      }
    }
  })().finally(() => {
    running.delete(roomId);
    const queued = db.prepare("SELECT 1 FROM agent_jobs WHERE room_id = ? AND status = 'queued' LIMIT 1").get(roomId);
    if (queued) ensureWorker(io, roomId, execute);
    else io.to(roomId).emit("agent:status", { status: "idle" });
  });
  running.set(roomId, loop);
}
