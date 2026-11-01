-- Fresh AgentRoom PostgreSQL schema. Contains no imported users or conversations.
CREATE TABLE "user" (
  id TEXT PRIMARY KEY, name TEXT, email TEXT, "emailVerified" BIGINT, image TEXT,
  email_verified_by_provider BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL, last_active_at BIGINT
);

CREATE TABLE account (
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  type TEXT NOT NULL, provider TEXT NOT NULL, "providerAccountId" TEXT NOT NULL,
  refresh_token TEXT, access_token TEXT, expires_at BIGINT, token_type TEXT,
  scope TEXT, id_token TEXT, session_state TEXT,
  PRIMARY KEY(provider, "providerAccountId")
);

CREATE TABLE session (
  "sessionToken" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires BIGINT NOT NULL
);

CREATE TABLE "verificationToken" (
  identifier TEXT NOT NULL, token TEXT NOT NULL, expires BIGINT NOT NULL,
  PRIMARY KEY(identifier, token)
);

CREATE TABLE authenticator (
  "credentialID" TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "providerAccountId" TEXT NOT NULL, "credentialPublicKey" TEXT NOT NULL,
  counter BIGINT NOT NULL, "credentialDeviceType" TEXT NOT NULL,
  "credentialBackedUp" BIGINT NOT NULL, transports TEXT,
  PRIMARY KEY("userId", "credentialID")
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  next_seq BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE members (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL, user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  last_seen TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), UNIQUE(room_id, id)
);

CREATE TABLE room_events (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, seq BIGINT NOT NULL,
  type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  PRIMARY KEY(room_id, seq)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL, author_name TEXT NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL,
  created_at TEXT NOT NULL, seq BIGINT NOT NULL, job_id TEXT, ai_mode TEXT, ai_agent TEXT, ai_provider TEXT, ai_model TEXT,
  UNIQUE(room_id, seq), UNIQUE(room_id, id)
);

CREATE TABLE agent_jobs (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL, requester_name TEXT NOT NULL, prompt TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), model TEXT, enqueue_order BIGINT, agent TEXT, provider TEXT,
  UNIQUE(room_id, idempotency_key)
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL, type TEXT NOT NULL, language TEXT NOT NULL, content TEXT NOT NULL,
  version BIGINT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(room_id, id)
);

CREATE TABLE artifact_versions (
  id BIGSERIAL PRIMARY KEY, room_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
  version BIGINT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL, language TEXT NOT NULL,
  content TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(room_id, artifact_id) REFERENCES artifacts(room_id, id) ON DELETE CASCADE,
  UNIQUE(artifact_id, version)
);

CREATE TABLE account_link_intents (
    token_hash TEXT PRIMARY KEY, session_token TEXT NOT NULL REFERENCES session("sessionToken") ON DELETE CASCADE,
    provider TEXT NOT NULL, expires BIGINT NOT NULL
  );

CREATE TABLE workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT 'violet',
    unclaimed_legacy BIGINT NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
  );

CREATE TABLE memberships (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('OWNER','ADMIN','MEMBER')), created_at BIGINT NOT NULL,
    PRIMARY KEY(workspace_id,user_id)
  );

CREATE TABLE channels (
    id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private')),
    archived BIGINT NOT NULL DEFAULT 0, is_general BIGINT NOT NULL DEFAULT 0,
    UNIQUE(workspace_id,name), UNIQUE(workspace_id,id)
  );

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
    expires_at BIGINT NOT NULL, max_uses BIGINT NOT NULL CHECK(max_uses > 0),
    uses BIGINT NOT NULL DEFAULT 0 CHECK(uses >= 0 AND uses <= max_uses), revoked BIGINT NOT NULL DEFAULT 0,
    email TEXT, created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL, created_at BIGINT NOT NULL
  );

CREATE TABLE audit_log (
    id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    actor_id TEXT REFERENCES "user"(id) ON DELETE SET NULL, action TEXT NOT NULL, detail TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );

CREATE TABLE ai_provider_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'openai' CHECK(provider='openai'), approved_models TEXT NOT NULL,
  pricing TEXT NOT NULL, credential_ciphertext TEXT, credential_last4 TEXT,
  monthly_token_limit BIGINT NOT NULL CHECK(monthly_token_limit>=0),
  monthly_spend_micros BIGINT NOT NULL CHECK(monthly_spend_micros>=0)
 );

CREATE TABLE usage_records (
  id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  job_id TEXT UNIQUE REFERENCES agent_jobs(id) ON DELETE SET NULL,
  model TEXT NOT NULL,mode TEXT NOT NULL,input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,reserved_tokens BIGINT NOT NULL DEFAULT 0,
  cost_micros BIGINT NOT NULL DEFAULT 0,reserved_cost_micros BIGINT NOT NULL DEFAULT 0,
  input_rate DOUBLE PRECISION NOT NULL,output_rate DOUBLE PRECISION NOT NULL,status TEXT NOT NULL,created_at BIGINT NOT NULL
 , provider TEXT, agent TEXT);

CREATE TABLE workspace_avatar_files (
  filename TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,created_at BIGINT NOT NULL
 );

CREATE TABLE ai_workspace_config (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled_providers TEXT NOT NULL, approved_models TEXT NOT NULL,
  default_model TEXT, muse_model TEXT, allow_paid BIGINT NOT NULL DEFAULT 0,
  user_hourly_limit BIGINT NOT NULL, workspace_daily_limit BIGINT NOT NULL
 );

CREATE INDEX users_email_idx ON "user"(email);

CREATE INDEX accounts_user_idx ON account("userId");

CREATE INDEX sessions_user_idx ON session("userId");

CREATE INDEX events_room_seq_idx ON room_events(room_id, seq);

CREATE INDEX messages_room_seq_idx ON messages(room_id, seq);

CREATE INDEX jobs_room_status_idx ON agent_jobs(room_id, status, created_at);

CREATE INDEX artifacts_room_idx ON artifacts(room_id);

CREATE INDEX artifact_versions_room_idx ON artifact_versions(room_id, artifact_id, version);

CREATE INDEX members_room_idx ON members(room_id);

CREATE INDEX members_user_idx ON members(user_id, room_id);

CREATE UNIQUE INDEX members_room_user_unique ON members(room_id, user_id) WHERE user_id IS NOT NULL;

CREATE INDEX link_expiry_idx ON account_link_intents(expires);

CREATE INDEX memberships_user_idx ON memberships(user_id,workspace_id);

CREATE INDEX channels_workspace_idx ON channels(workspace_id,archived);

CREATE UNIQUE INDEX channels_general_idx ON channels(workspace_id) WHERE is_general = 1;

CREATE INDEX invitations_workspace_idx ON invitations(workspace_id,created_at);

CREATE INDEX audit_workspace_idx ON audit_log(workspace_id,created_at);

CREATE INDEX usage_workspace_month_idx ON usage_records(workspace_id,created_at);

CREATE UNIQUE INDEX one_running_job_per_channel_idx ON agent_jobs(room_id) WHERE status='running';

CREATE UNIQUE INDEX jobs_channel_order_idx ON agent_jobs(room_id,enqueue_order);

CREATE INDEX workspace_avatar_files_idx ON workspace_avatar_files(workspace_id);

ALTER TABLE agent_jobs ADD COLUMN worker_id TEXT;
ALTER TABLE agent_jobs ADD COLUMN lease_expires_at BIGINT;
CREATE TABLE workspace_avatar_blobs (filename TEXT PRIMARY KEY REFERENCES workspace_avatar_files(filename) ON DELETE CASCADE, content BYTEA NOT NULL CHECK(octet_length(content)<=1048576));
