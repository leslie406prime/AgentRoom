import { beforeEach, describe, expect, it } from "vitest";
import { db, createRoom } from "../src/server/db";
import { cancelJob, claimNextJob, recoverJobs, submitJob, updateJob } from "../src/server/queue";

let roomId: string;
let memberId: string;

function setupRoom() {
  roomId = `room-test-${Math.random().toString(36).slice(2, 14)}`;
  memberId = `member-${Math.random().toString(36).slice(2, 14)}`;
  createRoom(roomId, "Queue tests");
  db.prepare("INSERT INTO members (id, room_id, name, color) VALUES (?, ?, ?, ?)")
    .run(memberId, roomId, "Test member", "#7587ff");
}

function enqueue(prompt: string, key = `request-${Math.random().toString(36).slice(2, 14)}`) {
  return submitJob({ roomId, memberId, prompt, idempotencyKey: key });
}

beforeEach(setupRoom);

describe("room agent queue", () => {
  it("claims queued work in FIFO order and permits only one running job", () => {
    const first = enqueue("first").job;
    const second = enqueue("second").job;
    expect(claimNextJob(roomId)?.id).toBe(first.id);
    expect(claimNextJob(roomId)).toBeUndefined();
    updateJob(roomId, first.id, "completed");
    expect(claimNextJob(roomId)?.id).toBe(second.id);
  });

  it("claims once even when multiple claimants race", () => {
    enqueue("only one");
    const outcomes = [claimNextJob(roomId), claimNextJob(roomId)];
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });

  it("returns an existing job for duplicate idempotency keys", () => {
    const first = enqueue("same request", "stable-idempotency-key");
    const retry = enqueue("same request", "stable-idempotency-key");
    expect(retry.duplicate).toBe(true);
    expect(retry.job.id).toBe(first.job.id);
  });

  it("continues after failure and allows the requester to cancel queued work", () => {
    const first = enqueue("fails").job;
    const second = enqueue("continues").job;
    const third = enqueue("cancel me").job;
    expect(claimNextJob(roomId)?.id).toBe(first.id);
    updateJob(roomId, first.id, "failed", "friendly error");
    expect(claimNextJob(roomId)?.id).toBe(second.id);
    cancelJob(roomId, third.id, memberId);
    expect(db.prepare("SELECT status FROM agent_jobs WHERE id = ?").get(third.id)).toEqual({ status: "cancelled" });
  });

  it("requeues jobs interrupted by a server restart", () => {
    const job = enqueue("recover me").job;
    db.prepare("UPDATE agent_jobs SET status = 'running' WHERE id = ?").run(job.id);
    recoverJobs();
    expect(db.prepare("SELECT status FROM agent_jobs WHERE id = ?").get(job.id)).toEqual({ status: "queued" });
    expect(claimNextJob(roomId)?.id).toBe(job.id);
  });
});
