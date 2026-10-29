import { migrate } from "./migrations";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { authSchema } from "./auth-schema";

const filename = process.env.DATABASE_PATH ?? "./data/agentroom.sqlite";
if (filename !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });

export const db = new Database(filename);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

migrate(db, filename);
export const drizzleDb = drizzle(db, { schema: authSchema });

export type RoomEvent = { roomId: string; seq: number; type: string; payload: unknown; createdAt: string };
export const colors = ["#7587ff", "#ed8fbd", "#54b8a8", "#f0a75c", "#a58bfa", "#56a2d8", "#e37575", "#94b96b"];

export function createRoom(id: string, name: string) {
  db.prepare("INSERT INTO rooms (id, name) VALUES (?, ?)").run(id, name);
}

export function emitPersisted(roomId: string, type: string, payload: unknown): RoomEvent {
  return db.transaction(() => {
    const result = db.prepare("UPDATE rooms SET next_seq = next_seq + 1 WHERE id = ?").run(roomId);
    if (result.changes !== 1) throw new Error("Room no longer exists");
    const seq = (db.prepare("SELECT next_seq FROM rooms WHERE id = ?").get(roomId) as { next_seq: number }).next_seq;
    const createdAt = new Date().toISOString();
    db.prepare("INSERT INTO room_events (room_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(roomId, seq, type, JSON.stringify(payload), createdAt);
    return { roomId, seq, type, payload, createdAt };
  }).immediate();
}

export function eventAfter(roomId: string, seq: number) {
  return db.prepare("SELECT seq, type, payload, created_at AS createdAt FROM room_events WHERE room_id = ? AND seq > ? ORDER BY seq")
    .all(roomId, seq).map((row) => {
      const event = row as { seq: number; type: string; payload: string; createdAt: string };
      return { ...event, payload: JSON.parse(event.payload) as unknown };
    });
}

export function checkDatabaseHealth() { db.prepare("SELECT 1").get(); }
