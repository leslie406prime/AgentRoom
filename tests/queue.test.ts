import { beforeEach, describe, expect, it } from "vitest";
import { db, createRoom } from "../src/server/db";
import { cancelJob, claimNextJob, recoverJobs, submitJob, updateJob } from "../src/server/queue";

let roomId: string;
let memberId: string;

async function setupRoom() {
  roomId = `room-test-${Math.random().toString(36).slice(2, 14)}`;
  memberId = `member-${Math.random().toString(36).slice(2, 14)}`;
  (await createRoom(roomId, "Queue tests"));
  (await db.prepare("INSERT INTO members (id, room_id, name, color) VALUES (?, ?, ?, ?)")
    .run(memberId, roomId, "Test member", "#7587ff"));
}

async function enqueue(prompt: string, key = `request-${Math.random().toString(36).slice(2, 14)}`) {
  return (await submitJob({ roomId, memberId, prompt, idempotencyKey: key }));
}

beforeEach(setupRoom);

describe("room agent queue", () => {
  it("claims queued work in FIFO order and permits only one running job", async () => {
    const first = (await enqueue("first")).job;
    const second = (await enqueue("second")).job;
    expect((await claimNextJob(roomId))?.id).toBe(first.id);
    expect((await claimNextJob(roomId))).toBeUndefined();
    (await updateJob(roomId, first.id, "completed"));
    expect((await claimNextJob(roomId))?.id).toBe(second.id);
  });

  it("claims once even when multiple claimants race", async () => {
    (await enqueue("only one"));
    const outcomes = [(await claimNextJob(roomId)), (await claimNextJob(roomId))];
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });

  it("returns an existing job for duplicate idempotency keys", async () => {
    const first = (await enqueue("same request", "stable-idempotency-key"));
    const retry = (await enqueue("same request", "stable-idempotency-key"));
    expect(retry.duplicate).toBe(true);
    expect(retry.job.id).toBe(first.job.id);
  });

  it("continues after failure and allows the requester to cancel queued work", async () => {
    const first = (await enqueue("fails")).job;
    const second = (await enqueue("continues")).job;
    const third = (await enqueue("cancel me")).job;
    expect((await claimNextJob(roomId))?.id).toBe(first.id);
    (await updateJob(roomId, first.id, "failed", "friendly error"));
    expect((await claimNextJob(roomId))?.id).toBe(second.id);
    (await cancelJob(roomId, third.id, memberId));
    expect((await db.prepare("SELECT status FROM agent_jobs WHERE id = ?").get(third.id))).toEqual({ status: "cancelled" });
  });

  it("requeues jobs interrupted by a server restart", async () => {
    const job = (await enqueue("recover me")).job;
    (await db.prepare("UPDATE agent_jobs SET status = 'running' WHERE id = ?").run(job.id));
    (await recoverJobs());
    expect((await db.prepare("SELECT status FROM agent_jobs WHERE id = ?").get(job.id))).toEqual({ status: "queued" });
    expect((await claimNextJob(roomId))?.id).toBe(job.id);
  });
});
