CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  next_seq INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL,
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