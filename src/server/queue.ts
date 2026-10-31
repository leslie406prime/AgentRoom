import { hasMultipleAgentMentions } from "../lib/ai-catalog";
import { PublicJobError, agentFailureDiagnostic, safeModel, safeProvider } from "./job-errors";
import { failUsage } from "./ai-repository";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, emitPersisted } from "./db";
import type { Server } from "socket.io";
import {workerId,databaseNow,leaseDurationMs,requireJobLease,expireJobLeases,heartbeatJob} from "./worker-leases";

export const ArtifactOutput = z.object({
  title: z.string().trim().min(1).max(80),
  type: z.enum(["code", "document"]),
  language: z.string().trim().min(1).max(32),
  content: z.string().max(50000),
});

type Job = { id: string; room_id: string; requester_id: string; requester_name: string; prompt: string; idempotency_key: string; status: string; model?: string | null; agent?: string | null; provider?: string | null };
const running = new Map<string, Promise<void>>();
let draining=false;
export async function drainWorkers(timeoutMs=25000){
  draining=true;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([Promise.allSettled([...running.values()]),new Promise<void>(resolve=>{timer=setTimeout(resolve,timeoutMs);timer.unref();})]);}
  finally{if(timer)clearTimeout(timer);}
}
const QueueInput = z.object({ roomId: z.string().min(12).max(64), memberId: z.string().min(8).max(80), prompt: z.string().trim().min(1).max(4000).refine(value=>!hasMultipleAgentMentions(value),"Choose one agent mention per request."), idempotencyKey: z.string().min(8).max(100), model: z.string().min(1).max(100).optional(), agent: z.enum(["muse", "gemini", "groq", "llama", "agent"]).optional(), provider: z.string().max(20).nullable().optional() });

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

export async function listQueueJobs(roomId: string) {
  return (await db.prepare("SELECT id, requester_id AS requesterId, requester_name AS requesterName, prompt, status, error, model, agent, provider FROM agent_jobs WHERE room_id = ? AND status IN ('queued', 'running', 'failed') ORDER BY enqueue_order").all(roomId));
}

async function broadcastQueue(io: Server, roomId: string) {
  io.to(roomId).emit("queue:update", (await listQueueJobs(roomId)));
}

export async function submitJob(input: z.infer<typeof QueueInput>) {
  const parsed = QueueInput.parse(input);
  const result = (await db.transaction(async () => {
    const prior = (await db.prepare("SELECT * FROM agent_jobs WHERE room_id = ? AND idempotency_key = ?").get(parsed.roomId, parsed.idempotencyKey)) as Job | undefined;
    if (prior) return { job: prior, duplicate: true, event: undefined };
    const member = (await db.prepare("SELECT name FROM members WHERE room_id = ? AND id = ?").get(parsed.roomId, parsed.memberId)) as { name: string } | undefined;
    if (!member) throw new Error("You are not a member of this room");
    const counts = (await db.prepare("SELECT COUNT(*) AS count FROM agent_jobs WHERE room_id = ? AND status IN ('queued', 'running')").get(parsed.roomId)) as { count: number };
    if (counts.count >= 20) throw new Error("This room's agent queue is full. Try again shortly.");
    const id = nanoid(16);
    const order=((await db.prepare("SELECT COALESCE(MAX(enqueue_order),0)+1 AS n FROM agent_jobs WHERE room_id=?").get(parsed.roomId)) as {n:number}).n;
    const now=new Date().toISOString();
    (await db.prepare("INSERT INTO agent_jobs (id, room_id, requester_id, requester_name, prompt, idempotency_key, status, model, enqueue_order, created_at, updated_at, agent, provider) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)")
      .run(id, parsed.roomId, parsed.memberId, member.name, parsed.prompt, parsed.idempotencyKey, parsed.model ?? null, order, now, now, parsed.agent ?? null, parsed.provider ?? null));
    const job = (await db.prepare("SELECT * FROM agent_jobs WHERE id = ?").get(id)) as Job;
    const event = (await emitPersisted(parsed.roomId, "job", publicJob(job)));
    return { job, duplicate: false, event };
  }).immediate());
  return result;
}

export async function claimNextJob(roomId: string, io?: Server): Promise<Job | undefined> {
  if(draining)return undefined;
  const result = (await db.transaction(async () => {
    if(db.kind==="postgres"){
      await db.prepare("SELECT id FROM rooms WHERE id=? FOR UPDATE").get(roomId);
      await expireJobLeases(roomId);
    }
    const isRunning = (await db.prepare("SELECT 1 FROM agent_jobs WHERE room_id = ? AND status = 'running'").get(roomId));
    if (isRunning) return undefined;
    const candidate = (await db.prepare("SELECT * FROM agent_jobs WHERE room_id = ? AND status = 'queued' ORDER BY enqueue_order LIMIT 1").get(roomId)) as Job | undefined;
    if (!candidate) return undefined;
    const result = (await db.prepare("UPDATE agent_jobs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'").run(new Date().toISOString(), candidate.id));
    if (result.changes !== 1) return undefined;
    if(db.kind==="postgres")await db.prepare("UPDATE agent_jobs SET worker_id=?,lease_expires_at="+databaseNow+"+? WHERE id=?").run(workerId,leaseDurationMs,candidate.id);
    const claimed = { ...candidate, status: "running" };
    const event = (await emitPersisted(roomId, "job", publicJob(claimed)));
    return { job: claimed, event };
  }).immediate());
  if (result && io) io.to(roomId).emit("room:event", result.event);
  return result?.job;
}

export async function updateJob(roomId: string, jobId: string, status: "completed" | "failed" | "cancelled", error?: string, io?: Server) {
  const event = (await db.transaction(async () => {
    const job = (await db.prepare("SELECT * FROM agent_jobs WHERE room_id = ? AND id = ?").get(roomId, jobId)) as Job | undefined;
    if (!job) return undefined;
    if(status==="cancelled"&&job.status!=="queued")throw new PublicJobError("Only queued jobs can be cancelled.");
    if(db.kind==="postgres"&&status!=="cancelled")await requireJobLease(jobId);
    (await db.prepare("UPDATE agent_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(status, error ?? null, new Date().toISOString(), jobId));
    return (await emitPersisted(roomId, "job", publicJob({ ...job, status }, error)));
  }).immediate());
  if (io && event) {
    io.to(roomId).emit("room:event", event);
    (await broadcastQueue(io, roomId));
  }
}

export async function cancelJob(roomId: string, jobId: string, memberId: string, io?: Server) {
  return db.transaction(async()=>{
  const job = (await db.prepare("SELECT * FROM agent_jobs WHERE room_id = ? AND id = ?").get(roomId, jobId)) as (Job & { error: string | null }) | undefined;
  if (!job || job.requester_id !== memberId) throw new Error("Only the requester can cancel this job");
  if (job.status !== "queued") throw new Error("Only queued jobs can be cancelled");
  (await updateJob(roomId, jobId, "cancelled", undefined, io));
  }).immediate();
}

export async function recoverJobs() {
  if(db.kind==="postgres"){await db.transaction(()=>expireJobLeases()).immediate();return;}
  const stuck = (await db.prepare("SELECT id, room_id FROM agent_jobs WHERE status = 'running'").all()) as { id: string; room_id: string }[];
  for (const job of stuck) {
    (await db.transaction(async () => {
      (await db.prepare("UPDATE agent_jobs SET status = 'queued', updated_at = ? WHERE id = ?").run(new Date().toISOString(), job.id));
      const recovered = (await db.prepare("SELECT * FROM agent_jobs WHERE id = ?").get(job.id)) as Job;
      (await emitPersisted(job.room_id, "job", publicJob(recovered)));
    }).immediate());
  }
}

export function ensureWorker(io: Server, roomId: string, execute: (job: Job, io: Server) => Promise<void>) {
  if (draining||running.has(roomId)) return;
  const loop = (async () => {
    while (!draining) {
      const job = (await claimNextJob(roomId, io));
      if (!job) break;
      (await broadcastQueue(io, roomId));
      io.to(roomId).emit("agent:status", { status: "working", requester: job.requester_name, jobId: job.id });
      const stopHeartbeat=heartbeatJob(job.id);
      try {
        await execute(job, io);
        (await updateJob(roomId, job.id, "completed", undefined, io));
      } catch (error) {
        (await failUsage(job.id, error instanceof PublicJobError && error.releaseUsage));
        console.error(JSON.stringify({ level: "error", event: "agent_job_failed", roomId, jobId: job.id, provider: safeProvider(job.provider), model: safeModel(job.model), agent: ["agent", "gemini", "groq", "llama", "muse"].includes(job.agent ?? "") ? job.agent : "agent", ...agentFailureDiagnostic(error) }));
        (await updateJob(roomId, job.id, "failed", error instanceof PublicJobError ? error.message : "The agent couldn't complete this request. Please retry.", io));
        io.to(roomId).emit("agent:done", { jobId: job.id });
      }finally{stopHeartbeat();}
    }
  })().finally(async () => {
    running.delete(roomId);
    const queued = (await db.prepare("SELECT 1 FROM agent_jobs WHERE room_id = ? AND status IN ('queued','running') LIMIT 1").get(roomId));
    if (queued&&!draining) {const timer=setTimeout(()=>ensureWorker(io,roomId,execute),1000);timer.unref();}
    else io.to(roomId).emit("agent:status", { status: "idle" });
  }).catch(()=>console.error(JSON.stringify({level:"error",event:"queue_worker_failed",roomId})));
  running.set(roomId, loop);
}
