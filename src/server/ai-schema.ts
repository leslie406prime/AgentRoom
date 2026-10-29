import type Database from "better-sqlite3";
export function migrateAI(db:Database.Database){
 db.exec(`CREATE TABLE ai_provider_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'openai' CHECK(provider='openai'), approved_models TEXT NOT NULL,
  pricing TEXT NOT NULL, credential_ciphertext TEXT, credential_last4 TEXT,
  monthly_token_limit INTEGER NOT NULL CHECK(monthly_token_limit>=0),
  monthly_spend_micros INTEGER NOT NULL CHECK(monthly_spend_micros>=0)
 );
 CREATE TABLE usage_records (
  id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  job_id TEXT UNIQUE REFERENCES agent_jobs(id) ON DELETE SET NULL,
  model TEXT NOT NULL,mode TEXT NOT NULL,input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,reserved_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,reserved_cost_micros INTEGER NOT NULL DEFAULT 0,
  input_rate REAL NOT NULL,output_rate REAL NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL
 );CREATE INDEX usage_workspace_month_idx ON usage_records(workspace_id,created_at);
 ALTER TABLE agent_jobs ADD COLUMN model TEXT;
 ALTER TABLE messages ADD COLUMN ai_mode TEXT;
 CREATE UNIQUE INDEX one_running_job_per_channel_idx ON agent_jobs(room_id) WHERE status='running';`);
}
// Schema v6: multi-provider agents. Additive only; existing rows and tables are untouched.
export function migrateProviders(db:Database.Database){
 db.exec(`CREATE TABLE ai_workspace_config (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled_providers TEXT NOT NULL, approved_models TEXT NOT NULL,
  default_model TEXT, muse_model TEXT, allow_paid INTEGER NOT NULL DEFAULT 0,
  user_hourly_limit INTEGER NOT NULL, workspace_daily_limit INTEGER NOT NULL
 );
 ALTER TABLE agent_jobs ADD COLUMN agent TEXT;
 ALTER TABLE agent_jobs ADD COLUMN provider TEXT;
 ALTER TABLE usage_records ADD COLUMN provider TEXT;
 ALTER TABLE usage_records ADD COLUMN agent TEXT;
 ALTER TABLE messages ADD COLUMN ai_agent TEXT;
 ALTER TABLE messages ADD COLUMN ai_provider TEXT;
 ALTER TABLE messages ADD COLUMN ai_model TEXT;`);
 // Workspaces that already saved their own OpenAI credential explicitly chose paid usage; keep that working.
 db.exec(`INSERT INTO ai_workspace_config(workspace_id,enabled_providers,approved_models,default_model,muse_model,allow_paid,user_hourly_limit,workspace_daily_limit)
  SELECT workspace_id,'["gemini","groq"]','["gemini:gemini-2.5-flash","gemini:gemini-2.5-flash-lite","groq:llama-3.3-70b-versatile","groq:llama-3.1-8b-instant"]','gemini:gemini-2.5-flash','gemini:gemini-2.5-flash',1,30,300 FROM ai_provider_settings WHERE credential_ciphertext IS NOT NULL`);
}
