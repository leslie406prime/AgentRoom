// Shared (client + server) AI catalog. Contains no secrets.
// Terminology: provider (who serves the API) / model (the underlying weights) /
// agent (the workspace-facing assistant a person @mentions) / credential source (where the key lives).
export type ProviderId = "gemini" | "groq" | "openai";
export type AgentId = "muse" | "gemini" | "llama" | "agent";
export type CatalogModel = { provider: Exclude<ProviderId, "openai">; id: string; label: string; family: "gemini" | "llama" | "other"; tier: "free" | "account-dependent"; localRpm: number; note?: string };

export const providerInfo: Record<ProviderId, { label: string; envKey: string; paid: boolean }> = {
  gemini: { label: "Google Gemini", envKey: "GEMINI_API_KEY", paid: false },
  groq: { label: "Groq", envKey: "GROQ_API_KEY", paid: false },
  openai: { label: "OpenAI", envKey: "OPENAI_API_KEY", paid: true },
};

// Model IDs were taken from Google's pricing page ("Free of charge" tier) and Groq's model/rate-limit pages.
// Only these models can be approved. A catalog entry is not proof of an account's billing tier. Live availability for a
// specific key is checked separately (see the owner "Check available models" action).
// localRpm is a conservative local guard, NOT the provider's actual limit.
export const catalog: CatalogModel[] = [
  { provider: "gemini", id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", family: "gemini", tier: "free", localRpm: 8 },
  { provider: "gemini", id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", family: "gemini", tier: "free", localRpm: 12 },
  { provider: "gemini", id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", family: "gemini", tier: "free", localRpm: 8 },
  { provider: "gemini", id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", family: "gemini", tier: "free", localRpm: 12 },
  { provider: "gemini", id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", family: "gemini", tier: "free", localRpm: 12 },
  { provider: "gemini", id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", family: "gemini", tier: "free", localRpm: 8 },
  { provider: "groq", id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", family: "llama", tier: "account-dependent", localRpm: 20, note: "Enterprise access listed. Check your account plan before approving; model visibility does not prove free access." },
  { provider: "groq", id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", family: "llama", tier: "account-dependent", localRpm: 20, note: "Enterprise access listed. Check your account plan before approving; model visibility does not prove free access." },
  { provider: "groq", id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (Groq)", family: "other", tier: "free", localRpm: 20 },
  { provider: "groq", id: "openai/gpt-oss-20b", label: "GPT-OSS 20B (Groq)", family: "other", tier: "free", localRpm: 20 },
  { provider: "groq", id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B (Groq, preview)", family: "other", tier: "free", localRpm: 20, note: "Preview model." },
];
export const defaultApprovedModels = ["gemini:gemini-3.5-flash-lite", "gemini:gemini-3.8-flash", "groq:openai/gpt-oss-20b"];
export const defaultModelKey = "gemini:gemini-3.5-flash-lite";

export const agentInfo: Record<AgentId, { label: string; mention: string; blurb: string }> = {
  muse: { label: "Muse", mention: "@Muse", blurb: "Channel memory, summaries, decisions and action items" },
  gemini: { label: "Gemini", mention: "@Gemini", blurb: "Google Gemini" },
  llama: { label: "Llama", mention: "@Llama", blurb: "Meta Llama on Groq" },
  agent: { label: "Room agent", mention: "@Agent", blurb: "Workspace default model" },
};
export const modelKey = (provider: ProviderId, id: string) => `${provider}:${id}`;
export function parseModelKey(value: string): { provider: ProviderId; id: string } | null {
  const match = /^(gemini|groq|openai):(.+)$/.exec(value);
  if (match) return { provider: match[1] as ProviderId, id: match[2] };
  return value ? { provider: "openai", id: value } : null; // pre-upgrade jobs stored bare OpenAI model IDs
}
export function catalogModel(key: string) {
  const parsed = parseModelKey(key);
  return parsed && parsed.provider !== "openai" ? catalog.find((m) => m.provider === parsed.provider && m.id === parsed.id) : undefined;
}
export function modelLabel(key: string) {
  const parsed = parseModelKey(key);
  if (!parsed) return key;
  return `${providerInfo[parsed.provider].label} · ${catalogModel(key)?.label ?? parsed.id}`;
}
const mentionPattern = /^@(muse|gemini|llama|agent)\b[:,]?\s*/i;
export function parseMention(text: string): { agent: AgentId; prompt: string } | null {
  const match = mentionPattern.exec(text.trim());
  return match ? { agent: match[1].toLowerCase() as AgentId, prompt: text.trim().slice(match[0].length) } : null;
}
