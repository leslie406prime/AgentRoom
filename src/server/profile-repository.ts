import { z } from "zod";
import { db } from "./db";
export const ProfileInput = z.object({ name: z.string().trim().min(1).max(40).regex(/^[^\u0000-\u001F\u007F]+$/) }).strict();
export type Profile = { id: string; name: string | null; email: string | null; image: string | null; emailVerified: number | null; created_at: number; last_active_at: number | null };
export async function ownProfile(userId: string) {
  return (await db.prepare('SELECT id, name, email, image, emailVerified, created_at, last_active_at FROM "user" WHERE id = ?').get(userId)) as Profile | undefined;
}
export async function updateProfile(userId: string, input: unknown) {
  const { name } = ProfileInput.parse(input);
  (await db.transaction(async () => {
    (await db.prepare('UPDATE "user" SET name = ? WHERE id = ?').run(name, userId));
    (await db.prepare('UPDATE members SET name = ? WHERE user_id = ?').run(name, userId));
  }).immediate());
  return (await ownProfile(userId));
}
const shared=process as typeof process & {__activityTouches?:Map<string,number>};
const activity=shared.__activityTouches??=new Map<string,number>();
export async function touchUser(userId: string, now = Date.now()) {
  if(activity.has(userId)&&now-activity.get(userId)!<180000)return 0;
  activity.set(userId,now);
  if(activity.size>10000)for(const [id,time] of activity)if(now-time>900000)activity.delete(id);
  return (await db.prepare('UPDATE "user" SET last_active_at = ? WHERE id = ? AND (last_active_at IS NULL OR last_active_at < ?)').run(now, userId, now - 180000)).changes;
}
