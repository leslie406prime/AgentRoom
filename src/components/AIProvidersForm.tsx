"use client";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import type { getAIConfig } from "@/server/ai-workspace";
type Config = Awaited<ReturnType<typeof getAIConfig>>;
type Check = { provider: string; ok: boolean; message?: string; models?: { key: string; accessible: boolean }[] };

export default function AIProvidersForm({ workspace, config }: { workspace: string; config: Config }) {
  const ready = useHydrated();
  const [providers, setProviders] = useState<string[]>(config.enabledProviders);
  const [approved, setApproved] = useState<string[]>(config.approvedModels);
  const [defaultModel, setDefaultModel] = useState(config.defaultModel ?? "");
  const [museModel, setMuseModel] = useState(config.museModel ?? "");
  const [allowPaid, setAllowPaid] = useState(config.allowPaid);
  const [hourly, setHourly] = useState(config.userHourlyLimit);
  const [daily, setDaily] = useState(config.workspaceDailyLimit);
  const [error, setError] = useState(""), [saved, setSaved] = useState(false), [checks, setChecks] = useState<Check[]>([]);
  const toggle = (list: string[], set: (v: string[]) => void, value: string) => set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const label = (key: string) => config.catalog.find((m) => m.key === key)?.label ?? key;
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(""); setSaved(false);
    const response = await fetch("/api/workspaces/" + workspace + "/ai/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabledProviders: providers, approvedModels: approved, defaultModel: defaultModel || null, museModel: museModel || null, allowPaid, userHourlyLimit: hourly, workspaceDailyLimit: daily }) });
    if (response.ok) setSaved(true); else setError((await response.json()).error ?? "Could not save AI settings.");
  }
  async function verify() {
    setError("");
    const response = await fetch("/api/workspaces/" + workspace + "/ai/verify", { method: "POST" });
    const data = await response.json();
    if (response.ok) setChecks(data.providers); else setError(data.error ?? "Could not check providers.");
  }
  return <section inert={!ready} className="settings-section"><h2 className="text-lg">AI agents and models</h2>
    <p className="text-xs leading-6 text-muted">Choose approved Gemini and Groq models for your team. Free access depends on your provider account plan; checking available models does not confirm billing eligibility. Review the account plan before approving conditional Llama models. AgentRoom never enables billing or switches to a paid provider automatically.</p>
    <form onSubmit={async (event) => void (await save(event))} className="space-y-5">
      <div className="space-y-2">{config.providers.map((p) => <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-panel p-3 text-xs">
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={providers.includes(p.id)} onChange={() => toggle(providers, setProviders, p.id)} />{p.label}</label>
        <span className="badge">{p.configured ? "Key configured" : p.envKey + " missing"}</span>
        {checks.filter((c) => c.provider === p.id).map((c) => <span key={c.provider} className="text-muted">{c.ok ? c.models!.filter((m) => m.accessible).length + " of " + c.models!.length + " catalog models accessible" : c.message}</span>)}
      </div>)}
        <button type="button" className="btn text-xs" onClick={async () => void (await verify())}>Check available models</button></div>
      <fieldset className="space-y-2"><legend className="text-xs font-medium">Approved models</legend>
        {config.catalog.map((m) => <label key={m.key} className="flex flex-wrap items-center gap-2 text-xs"><input type="checkbox" checked={approved.includes(m.key)} onChange={() => toggle(approved, setApproved, m.key)} />{m.label}<span className="text-muted">{m.key}</span>
          {checks.flatMap((c) => c.models ?? []).filter((x) => x.key === m.key).map((x) => <span key={x.key} className="badge">{x.accessible ? "Accessible" : "Not accessible with this key"}</span>)}
          {m.note && <span className="text-[11px] text-muted">{m.note}</span>}</label>)}</fieldset>
      <div className="flex flex-wrap gap-4">
        <label>Workspace default model<select aria-label="Workspace default model" className="block" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}><option value="">None</option>{approved.map((k) => <option key={k} value={k}>{label(k)}</option>)}</select></label>
        <label>Muse model<select aria-label="Muse model" className="block" value={museModel} onChange={(e) => setMuseModel(e.target.value)}><option value="">None (Muse unavailable)</option>{approved.map((k) => <option key={k} value={k}>{label(k)}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap gap-4">
        <label>Requests per member per hour<input aria-label="Requests per member per hour" type="number" min={0} max={1000} value={hourly} onChange={(e) => setHourly(Number(e.target.value))} /></label>
        <label>Requests per workspace per day<input aria-label="Requests per workspace per day" type="number" min={0} max={100000} value={daily} onChange={(e) => setDaily(Number(e.target.value))} /></label>
      </div>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={allowPaid} onChange={(e) => setAllowPaid(e.target.checked)} /><span>Authorize paid OpenAI usage for this workspace. Leave off unless you intend to be billed; OpenAI is never used otherwise.</span></label>
      <button className="btn-primary">Save agent settings</button>{saved && <span role="status" className="ml-3 text-xs text-success">Saved</span>}{error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </form></section>;
}
