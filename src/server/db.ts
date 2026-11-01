import { database } from "./database-access";
import { migratePostgres } from "./postgres-migrations";
export const db = database;
export async function initializeDatabase(){if(db.pool)await migratePostgres(db.pool);}

export type RoomEvent = { roomId: string; seq: number; type: string; payload: unknown; createdAt: string };
export const colors = ["#7587ff", "#ed8fbd", "#54b8a8", "#f0a75c", "#a58bfa", "#56a2d8", "#e37575", "#94b96b"];

export async function createRoom(id: string, name: string) {
  (await db.prepare("INSERT INTO rooms (id, name) VALUES (?, ?)").run(id, name));
}

export async function emitPersisted(roomId: string, type: string, payload: unknown): Promise<RoomEvent> {
  return (await db.transaction(async () => {
    const result = (await db.prepare("UPDATE rooms SET next_seq = next_seq + 1 WHERE id = ?").run(roomId));
    if (result.changes !== 1) throw new Error("Room no longer exists");
    const seq = ((await db.prepare("SELECT next_seq FROM rooms WHERE id = ?").get(roomId)) as { next_seq: number }).next_seq;
    const createdAt = new Date().toISOString();
    (await db.prepare("INSERT INTO room_events (room_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(roomId, seq, type, JSON.stringify(payload), createdAt));
    return { roomId, seq, type, payload, createdAt };
  }).immediate());
}

export async function eventAfter(roomId: string, seq: number) {
  return (await db.prepare("SELECT seq, type, payload, created_at AS createdAt FROM room_events WHERE room_id = ? AND seq > ? ORDER BY seq")
    .all(roomId, seq)).map((row) => {
      const event = row as { seq: number; type: string; payload: string; createdAt: string };
      return { ...event, payload: JSON.parse(event.payload) as unknown };
    });
}

export async function checkDatabaseHealth() { (await db.prepare("SELECT 1").get()); }
