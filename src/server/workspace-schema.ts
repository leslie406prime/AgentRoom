import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
export function migrateWorkspaceSchema(db: Database.Database) {
  db.exec(`CREATE TABLE workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT 'violet',
    unclaimed_legacy INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE TABLE memberships (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('OWNER','ADMIN','MEMBER')), created_at INTEGER NOT NULL,
    PRIMARY KEY(workspace_id,user_id)
  ); CREATE INDEX memberships_user_idx ON memberships(user_id,workspace_id);
  CREATE TABLE channels (
    id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private')),
    archived INTEGER NOT NULL DEFAULT 0, is_general INTEGER NOT NULL DEFAULT 0,
    UNIQUE(workspace_id,name), UNIQUE(workspace_id,id)
  ); CREATE INDEX channels_workspace_idx ON channels(workspace_id,archived);
  CREATE UNIQUE INDEX channels_general_idx ON channels(workspace_id) WHERE is_general = 1;
  CREATE TABLE channel_memberships (
    workspace_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL,
    PRIMARY KEY(workspace_id,channel_id,user_id),
    FOREIGN KEY(workspace_id,channel_id) REFERENCES channels(workspace_id,id) ON DELETE CASCADE,
    FOREIGN KEY(workspace_id,user_id) REFERENCES memberships(workspace_id,user_id) ON DELETE CASCADE
  );
  CREATE TABLE legacy_room_links (
    old_room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL UNIQUE REFERENCES channels(id) ON DELETE CASCADE
  );
  CREATE TABLE invitations (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('OWNER','ADMIN','MEMBER')),
    expires_at INTEGER NOT NULL, max_uses INTEGER NOT NULL CHECK(max_uses > 0),
    uses INTEGER NOT NULL DEFAULT 0 CHECK(uses >= 0 AND uses <= max_uses), revoked INTEGER NOT NULL DEFAULT 0,
    email TEXT, created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL, created_at INTEGER NOT NULL
  ); CREATE INDEX invitations_workspace_idx ON invitations(workspace_id,created_at);
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    actor_id TEXT REFERENCES "user"(id) ON DELETE SET NULL, action TEXT NOT NULL, detail TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ); CREATE INDEX audit_workspace_idx ON audit_log(workspace_id,created_at);
  `);
  const rooms=db.prepare("SELECT id,name FROM rooms").all() as {id:string;name:string}[];
  for(const room of rooms) {
    const workspace=randomUUID();
    db.prepare("INSERT INTO workspaces(id,name,unclaimed_legacy,created_at) VALUES (?,?,1,?)").run(workspace,room.name,Date.now());
    db.prepare("INSERT INTO channels(id,workspace_id,name,is_general) VALUES (?,?,'general',1)").run(room.id,workspace);
    db.prepare("INSERT INTO legacy_room_links(old_room_id,channel_id) VALUES (?,?)").run(room.id,room.id);
  }
}
