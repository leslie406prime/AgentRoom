import { z } from "zod";
import { db } from "./db";
import { requireRole, audit } from "./workspace-repository";
import { HttpError } from "./http-security";
import { openaiAccess } from "./ai-repository";
import { providerKey, cachedVerification } from "./ai-providers";
import type { JobErrorCode } from "./job-errors";
import { agentInfo, catalog, catalogModel, defaultApprovedModels, defaultModelKey, modelKey, modelLabel, parseModelKey, providerInfo, type AgentId, type ProviderId } from "../lib/ai-catalog";

export type WorkspaceAIConfig = { enabledProviders: Exclude<ProviderId, "openai">[]; approvedModels: string[]; defaultModel: string | null; museModel: string | null; allowPaid: boolean; userHourlyLimit: number; workspaceDailyLimit: number };
const FreeProvider = z.enum(["gemini", "groq"]);
export const AIConfigInput = z.object({
  enabledProviders: z.array(FreeProvider).max(2), approvedModels: z.array(z.string().max(120)).max(20),
  defaultModel: z.string().max(140).nullable(), museModel: z.string().max(140).nullable(), allowPaid: z.boolean(),
  userHourlyLimit: z.number().int().min(0).max(1000), workspaceDailyLimit: z.number().int().min(0).max(100000),
}).strict().superRefine((value, ctx) => {
  const bad = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new Set(value.approvedModels).size !== value.approvedModels.length) bad("Approved models must be unique.");
  if (value.approvedModels.some((key) => !catalogModel(key))) bad("Only supported free-tier models can be approved.");
  if (value.defaultModel && !value.approvedModels.includes(value.defaultModel) && !(value.allowPaid && parseModelKey(value.defaultModel)?.provider === "openai")) bad("The default model must be approved.");
  if (value.museModel && !value.approvedModels.includes(value.museModel)) bad("Muse must use an approved Gemini or Groq model.");
});
const defaults = (): WorkspaceAIConfig => ({ enabledProviders: ["gemini", "groq"], approvedModels: [...defaultApprovedModels], defaultModel: defaultModelKey, museModel: defaultModelKey, allowPaid: false, userHourlyLimit: 30, workspaceDailyLimit: 300 });
type Row = { enabled_providers: string; approved_models: string; default_model: string | null; muse_model: string | null; allow_paid: number; user_hourly_limit: number; workspace_daily_limit: number };
export function loadConfig(workspace: string): WorkspaceAIConfig {
  const row = db.prepare("SELECT enabled_providers,approved_models,default_model,muse_model,allow_paid,user_hourly_limit,workspace_daily_limit FROM ai_workspace_config WHERE workspace_id=?").get(workspace) as Row | undefined;
  if (!row) return defaults();
  return { enabledProviders: z.array(FreeProvider).parse(JSON.parse(row.enabled_providers)), approvedModels: z.array(z.string()).parse(JSON.parse(row.approved_models)), defaultModel: row.default_model, museModel: row.muse_model, allowPaid: Boolean(row.allow_paid), userHourlyLimit: row.user_hourly_limit, workspaceDailyLimit: row.workspace_daily_limit };
}

export type Availability = { available: true } | { available: false; reason: string; code?: JobErrorCode };
export function modelAvailability(workspace: string, cfg: WorkspaceAIConfig, key: string): Availability {
  const parsed = parseModelKey(key);
  if (!parsed) return { available: false, reason: "Unknown model." };
  const no = (reason: string, code: JobErrorCode = "MODEL_PERMISSION"): Availability => ({ available: false, reason, code });
  if (parsed.provider === "openai") {
    if (!cfg.allowPaid) return no("Paid OpenAI usage has not been authorized by a workspace owner.");
    const access = openaiAccess(workspace);
    if (!access.approved.includes(parsed.id)) return no("Not approved by a workspace owner.");
    return access.source ? { available: true } : no("No OpenAI credential is configured.", "MISSING_ENVIRONMENT");
  }
  if (!catalogModel(key)) return no("Not a supported free-tier model.");
  const info = providerInfo[parsed.provider];
  if (!cfg.enabledProviders.includes(parsed.provider)) return no(`${info.label} is disabled by a workspace owner.`);
  if (!cfg.approvedModels.includes(key)) return no("Not approved by a workspace owner.");
  if (!providerKey(parsed.provider)) return no(`Not configured: ${info.envKey} is missing on the server.`, "MISSING_ENVIRONMENT");
  const check = cachedVerification(parsed.provider);
  if (check && !check.ok) return no(check.message, "PROVIDER_VERIFICATION");
  if (check?.ok && !check.ids.includes(parsed.id)) return no("Not accessible with the server's configured key.");
  return { available: true };
}
const credentialFor = (workspace: string, provider: ProviderId) => provider === "openai" ? (openaiAccess(workspace).source ?? "environment") : "environment" as const;
export type Target = { ok: true; agent: AgentId; modelKey: string | null; credential: "environment" | "workspace" | "demo" } | { ok: false; reason: string; code?: JobErrorCode };

function firstAvailable(workspace: string, cfg: WorkspaceAIConfig, keys: string[]) { return keys.find((key) => modelAvailability(workspace, cfg, key).available); }
export function agentTarget(workspace: string, cfg: WorkspaceAIConfig, agent: AgentId, requested?: string | null): Target {
  const done = (key: string): Target => ({ ok: true, agent, modelKey: key, credential: credentialFor(workspace, parseModelKey(key)!.provider) });
  const fail = (reason: string, code: JobErrorCode = "MODEL_PERMISSION"): Target => ({ ok: false, reason, code });
  const check = (key: string): Target => { const a = modelAvailability(workspace, cfg, key); return a.available ? done(key) : fail(a.reason, a.code); };
  const approvedFree = cfg.approvedModels;
  if (agent === "muse") {
    if (requested) return fail("Muse's model is chosen by a workspace owner and cannot be overridden.");
    return cfg.museModel ? check(cfg.museModel) : fail("A workspace owner has not chosen a model for Muse.");
  }
  if (agent === "gemini" || agent === "llama") {
    const mine = (key: string) => { const m = catalogModel(key); return agent === "gemini" ? m?.provider === "gemini" : m?.family === "llama"; };
    if (requested) return mine(requested) ? check(requested) : fail(agent === "gemini" ? "@Gemini only runs approved Gemini models." : "@Llama only runs approved Llama models.");
    const candidates = approvedFree.filter(mine), preferred = cfg.defaultModel && mine(cfg.defaultModel) ? [cfg.defaultModel] : [];
    if (!candidates.length) return fail(`No ${agentInfo[agent].label} model is approved for this workspace.`);
    const key = firstAvailable(workspace, cfg, [...preferred, ...candidates]);
    return key ? done(key) : check(candidates[0]);
  }
  if (requested) return check(requested);
  const openai = cfg.allowPaid ? openaiAccess(workspace).approved.map((id) => modelKey("openai", id)) : [];
  const key = firstAvailable(workspace, cfg, [...(cfg.defaultModel ? [cfg.defaultModel] : []), ...catalog.map((m) => modelKey(m.provider, m.id)), ...openai]);
  return key ? done(key) : { ok: true, agent, modelKey: null, credential: "demo" };
}
export function defaultAgent(workspace: string, cfg = loadConfig(workspace)): AgentId { return agentTarget(workspace, cfg, "muse").ok ? "muse" : "agent"; }

export function publicAIConfig(actor: string, workspace: string) {
  requireRole(actor, workspace);
  const cfg = loadConfig(workspace), models = [...cfg.approvedModels, ...(cfg.allowPaid ? openaiAccess(workspace).approved.map((id) => modelKey("openai", id)) : [])];
  const modelOptions = models.map((key) => { const a = modelAvailability(workspace, cfg, key); return { key, label: modelLabel(key), provider: parseModelKey(key)!.provider, available: a.available, ...(a.available ? {} : { reason: a.reason }) }; });
  const agents = (Object.keys(agentInfo) as AgentId[]).map((id) => { const t = agentTarget(workspace, cfg, id); return { id, label: agentInfo[id].label, mention: agentInfo[id].mention, blurb: agentInfo[id].blurb, available: t.ok && (t.credential !== "demo" || id === "agent"), demo: t.ok && t.credential === "demo", modelKey: t.ok ? t.modelKey : null, modelLabel: t.ok && t.modelKey ? modelLabel(t.modelKey) : null, ...(t.ok ? {} : { reason: t.reason }) }; });
  const legacy = agentTarget(workspace, cfg, "agent");
  return { models: modelOptions.filter((m) => m.available).map((m) => m.key), mode: legacy.ok ? legacy.credential : "demo", defaultAgent: defaultAgent(workspace, cfg), agents, modelOptions };
}

export function getAIConfig(actor: string, workspace: string) {
  requireRole(actor, workspace, "settings");
  const cfg = loadConfig(workspace);
  return {
    ...cfg,
    providers: (["gemini", "groq"] as const).map((id) => ({ id, label: providerInfo[id].label, envKey: providerInfo[id].envKey, configured: Boolean(providerKey(id)), enabled: cfg.enabledProviders.includes(id), verification: cachedVerification(id) ? (cachedVerification(id)!.ok ? { ok: true as const, ids: (cachedVerification(id) as { ids: string[] }).ids } : { ok: false as const, message: (cachedVerification(id) as { message: string }).message }) : null })),
    catalog: catalog.map((m) => ({ key: modelKey(m.provider, m.id), label: m.label, provider: m.provider, note: m.note ?? null })),
  };
}
export function updateAIConfig(actor: string, workspace: string, input: unknown) {
  const parsed = AIConfigInput.parse(input);
  db.transaction(() => {
    requireRole(actor, workspace, "settings");
    db.prepare("INSERT INTO ai_workspace_config(workspace_id,enabled_providers,approved_models,default_model,muse_model,allow_paid,user_hourly_limit,workspace_daily_limit) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET enabled_providers=excluded.enabled_providers,approved_models=excluded.approved_models,default_model=excluded.default_model,muse_model=excluded.muse_model,allow_paid=excluded.allow_paid,user_hourly_limit=excluded.user_hourly_limit,workspace_daily_limit=excluded.workspace_daily_limit")
      .run(workspace, JSON.stringify(parsed.enabledProviders), JSON.stringify(parsed.approvedModels), parsed.defaultModel, parsed.museModel, parsed.allowPaid ? 1 : 0, parsed.userHourlyLimit, parsed.workspaceDailyLimit);
    audit(workspace, actor, "ai:config", { providers: parsed.enabledProviders, allowPaid: parsed.allowPaid });
  }).immediate();
  return getAIConfig(actor, workspace);
}

// Called inside the enqueue transaction after the job row exists; throwing rolls the job back.
export function enforceRequestLimits(actor: string, workspace: string, cfg = loadConfig(workspace)) {
  const count = (since: number, userId?: string) => (db.prepare(`SELECT COUNT(*) AS n FROM agent_jobs j JOIN channels c ON c.id=j.room_id ${userId ? "JOIN members m ON m.id=j.requester_id AND m.room_id=j.room_id" : ""} WHERE c.workspace_id=? AND j.status<>'cancelled' AND j.created_at>=? ${userId ? "AND m.user_id=?" : ""}`).get(...[workspace, new Date(since).toISOString(), ...(userId ? [userId] : [])]) as { n: number }).n;
  if (count(Date.now() - 3_600_000, actor) > cfg.userHourlyLimit) throw new HttpError(429, `You have reached this workspace's limit of ${cfg.userHourlyLimit} AI requests per hour.`);
  if (count(Date.now() - 86_400_000) > cfg.workspaceDailyLimit) throw new HttpError(429, `This workspace has reached its daily limit of ${cfg.workspaceDailyLimit} AI requests.`);
}
