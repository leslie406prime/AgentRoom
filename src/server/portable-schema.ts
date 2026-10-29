import type Database from "better-sqlite3";
export function migratePortableOrder(db:Database.Database){
 db.exec(`ALTER TABLE agent_jobs ADD COLUMN enqueue_order INTEGER;
 UPDATE agent_jobs SET enqueue_order=(SELECT n FROM (SELECT id,ROW_NUMBER() OVER(PARTITION BY room_id ORDER BY created_at,rowid) AS n FROM agent_jobs) ordered WHERE ordered.id=agent_jobs.id);
 CREATE UNIQUE INDEX jobs_channel_order_idx ON agent_jobs(room_id,enqueue_order);
 CREATE TABLE workspace_avatar_files (
  filename TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,created_at INTEGER NOT NULL
 );CREATE INDEX workspace_avatar_files_idx ON workspace_avatar_files(workspace_id);`);
 const avatars=db.prepare("SELECT id,avatar FROM workspaces").all() as {id:string;avatar:string}[];
 for(const row of avatars)if(/^[0-9a-f-]{36}\.webp$/.test(row.avatar))db.prepare("INSERT INTO workspace_avatar_files(filename,workspace_id,created_at) VALUES (?,?,?)").run(row.avatar,row.id,Date.now());
}
