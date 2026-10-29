import { migratePortableOrder } from "./portable-schema";
export const LATEST_SCHEMA_VERSION=6;
import { migrateAI,migrateProviders } from "./ai-schema";
import type Database from "better-sqlite3";
import path from "node:path";
import { migrateWorkspaceSchema } from "./workspace-schema";
export function migrate(db: Database.Database, filename: string) {
const schemaMigrationExists = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get());
const currentMigration = schemaMigrationExists
  ? Number((db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null }).version ?? 0)
  : 0;
if(currentMigration > LATEST_SCHEMA_VERSION) throw new Error("Database schema is newer than this application.");
const hasExistingData = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get());
if (filename !== ":memory:" && currentMigration < LATEST_SCHEMA_VERSION && hasExistingData) {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  const backupPath = path.resolve(`${filename}.${timestamp}.${crypto.randomUUID()}.bak`);
  const escapedPath = backupPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escapedPath}'`);
}

db.transaction(() => {
db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY, name TEXT, email TEXT, emailVerified INTEGER, image TEXT,
  email_verified_by_provider INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_active_at INTEGER
);
CREATE INDEX IF NOT EXISTS users_email_idx ON "user"(email);
CREATE TABLE IF NOT EXISTS account (
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  type TEXT NOT NULL, provider TEXT NOT NULL, providerAccountId TEXT NOT NULL,
  refresh_token TEXT, access_token TEXT, expires_at INTEGER, token_type TEXT,
  scope TEXT, id_token TEXT, session_state TEXT,
  PRIMARY KEY(provider, providerAccountId)
);
CREATE INDEX IF NOT EXISTS accounts_user_idx ON account(userId);
CREATE TABLE IF NOT EXISTS session (
  sessionToken TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON session(userId);
CREATE TABLE IF NOT EXISTS verificationToken (
  identifier TEXT NOT NULL, token TEXT NOT NULL, expires INTEGER NOT NULL,
  PRIMARY KEY(identifier, token)
);
CREATE TABLE IF NOT EXISTS authenticator (
  credentialID TEXT NOT NULL UNIQUE,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  providerAccountId TEXT NOT NULL, credentialPublicKey TEXT NOT NULL,
  counter INTEGER NOT NULL, credentialDeviceType TEXT NOT NULL,
  credentialBackedUp INTEGER NOT NULL, transports TEXT,
  PRIMARY KEY(userId, credentialID)
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  next_seq INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL, user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(room_id, id)
);
CREATE TABLE IF NOT EXISTS room_events (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, seq INTEGER NOT NULL,
  type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(room_id, seq)
);
CREATE INDEX IF NOT EXISTS events_room_seq_idx ON room_events(room_id, seq);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL, author_name TEXT NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL,
  created_at TEXT NOT NULL, seq INTEGER NOT NULL, job_id TEXT,
  UNIQUE(room_id, seq), UNIQUE(room_id, id)
);
CREATE INDEX IF NOT EXISTS messages_room_seq_idx ON messages(room_id, seq);
CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL, requester_name TEXT NOT NULL, prompt TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS jobs_room_status_idx ON agent_jobs(room_id, status, created_at);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL, type TEXT NOT NULL, language TEXT NOT NULL, content TEXT NOT NULL,
  version INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(room_id, id)
);
CREATE INDEX IF NOT EXISTS artifacts_room_idx ON artifacts(room_id);
CREATE TABLE IF NOT EXISTS artifact_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL, language TEXT NOT NULL,
  content TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(room_id, artifact_id) REFERENCES artifacts(room_id, id) ON DELETE CASCADE,
  UNIQUE(artifact_id, version)
);
CREATE INDEX IF NOT EXISTS artifact_versions_room_idx ON artifact_versions(room_id, artifact_id, version);
`);

const memberColumns = db.prepare("PRAGMA table_info(members)").all() as { name: string }[];
if (!memberColumns.some((column) => column.name === "user_id")) {
  db.exec('ALTER TABLE members ADD COLUMN user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL');
}
db.exec("CREATE INDEX IF NOT EXISTS members_room_idx ON members(room_id)");
db.exec("CREATE INDEX IF NOT EXISTS members_user_idx ON members(user_id, room_id)");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS members_room_user_unique ON members(room_id, user_id) WHERE user_id IS NOT NULL");
db.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)").run();
if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 2").get()) {
  db.exec(`CREATE TABLE IF NOT EXISTS account_link_intents (
    token_hash TEXT PRIMARY KEY, session_token TEXT NOT NULL REFERENCES session(sessionToken) ON DELETE CASCADE,
    provider TEXT NOT NULL, expires INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS link_expiry_idx ON account_link_intents(expires);`);
  db.prepare("INSERT INTO schema_migrations(version) VALUES (2)").run();
}
if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 3").get()) {
  migrateWorkspaceSchema(db);
  db.prepare("INSERT INTO schema_migrations(version) VALUES (3)").run();
}
if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 4").get()) {
 migrateAI(db);db.prepare("INSERT INTO schema_migrations(version) VALUES (4)").run();
}
if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 5").get()) {
 migratePortableOrder(db);db.prepare("INSERT INTO schema_migrations(version) VALUES (5)").run();
}
if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 6").get()) {
 migrateProviders(db);db.prepare("INSERT INTO schema_migrations(version) VALUES (6)").run();
}
}).immediate();

}
