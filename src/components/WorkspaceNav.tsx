/* eslint-disable @next/next/no-img-element */
"use client";
import { useHydrated } from "@/lib/use-hydrated";
import Link from "next/link";
import Icon from "./Icon";
import { useState } from "react";
import { can } from "@/server/permissions";
import type { Role } from "@/server/permissions";

export type WorkspaceNavData = { id: string; name: string; avatar?: string; role?: Role; channels: { id: string; name: string; archived: number }[] };

export default function WorkspaceNav({ workspace, workspaces, user, activeChannelId, showIdentity = true, showSettings = true, agents = [], selectedAgent, onSelectAgent }: {
  workspace: WorkspaceNavData; workspaces: { id: string; name: string }[]; user: { name: string; image?: string | null };
  activeChannelId?: string; showIdentity?: boolean; showSettings?: boolean;
  agents?: { id: string; label: string; blurb: string; available: boolean; demo?: boolean; reason?: string; modelLabel?: string | null }[];
  selectedAgent?: string; onSelectAgent?: (id: string) => void;
}) {
  const ready = useHydrated();
  const [creating,setCreating]=useState(false), [channelName,setChannelName]=useState(""), [error,setError]=useState(""), [busy,setBusy]=useState(false);
  async function createChannel(event: React.FormEvent) {
    event.preventDefault(); if(busy)return;
    const normalized=channelName.trim().toLowerCase().replace(/\s+/g,"-");
    if(!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(normalized) || normalized.length>64){setError("Use 1–64 letters or numbers separated by spaces, hyphens or underscores.");return;}
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/workspaces/"+workspace.id+"/channels",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:normalized})});
      const data=await response.json(); if(!response.ok)throw new Error(data.error??"Could not create channel.");
      window.location.assign("/workspaces/"+workspace.id+"/channels/"+data.id);
    } catch(error){setError(error instanceof Error?error.message:"Could not create channel.");setBusy(false);}
  }
  return <section inert={!ready} className="space-y-6 px-3 py-4">
    <div className="flex items-center gap-2.5 px-1">
      {workspace.avatar?.endsWith(".webp")
        ? <img src={"/api/workspaces/" + workspace.id + "/avatar"} alt="Workspace avatar" className="h-9 w-9 shrink-0 rounded-md object-cover" />
        : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-white text-xs font-semibold" style={{ color: ({ violet: "#6D5AE6", blue: "#346C9E", green: "#39745A", orange: "#9A5F30" } as Record<string, string>)[workspace.avatar ?? "violet"] }}>{workspace.name.slice(0, 2).toUpperCase()}</span>}
      <label className="min-w-0 flex-1"><span className="block text-[10px] text-muted">Your workspace</span>
        <select aria-label="Switch workspace" className="mt-0.5 w-full truncate bg-transparent pr-1 text-xs font-semibold" value={workspace.id} onChange={e => window.location.assign("/workspaces/" + e.target.value)}>
          {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </label>
    </div>
    <nav aria-label="Channels">
      <div className="mb-2 flex items-center justify-between px-2"><h2 className="eyebrow">Channels <span className="ml-1 text-[10px]">{workspace.channels.length}</span></h2>{can(workspace.role,"channel:manage") && <button aria-label="Create channel" className="icon-button" onClick={()=>{setCreating(true);setError("");}}><Icon name="plus" /></button>}</div>
      {creating && <dialog ref={node=>{if(node && !node.open)node.showModal();}} aria-label="Create channel" className="fixed inset-0 z-50 m-auto w-[min(90vw,380px)] rounded-lg border border-line bg-white p-6 shadow-xl" onCancel={()=>setCreating(false)}><form onSubmit={async event=>void (await createChannel(event))}><h2 className="text-lg font-semibold">Create channel</h2><label className="mt-4 block text-xs">Channel name<input autoFocus required maxLength={64} aria-label="Channel name" className="field" value={channelName} onChange={event=>setChannelName(event.target.value)} /></label><p className="mt-2 text-xs text-muted">Letters, numbers, hyphens and underscores. Spaces become hyphens.</p>{error&&<p role="alert" className="mt-3 text-xs text-danger">{error}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" className="btn" disabled={busy} onClick={()=>setCreating(false)}>Cancel</button><button className="btn-primary" disabled={busy}>{busy?"Creating…":"Create"}</button></div></form></dialog>}
      <div className="space-y-0.5">{workspace.channels.map(c => <Link key={c.id} aria-current={activeChannelId === c.id ? "page" : undefined}
        className={`flex min-h-9 items-center gap-2 rounded-md px-2 text-[13px] transition-colors ${activeChannelId === c.id ? "bg-accent/[.08] font-medium text-accent" : "text-muted hover:bg-hover hover:text-ink"}`}
        href={"/workspaces/" + workspace.id + "/channels/" + c.id}>
        <Icon name="hash" className="h-4 w-4 shrink-0 opacity-70" /><span className="truncate">{c.name}</span>{Boolean(c.archived) && <span className="ml-auto text-[10px]">Archived</span>}
      </Link>)}</div>
    </nav>
    {agents.length > 0 && <nav aria-label="AI agents">
      <h2 className="eyebrow mb-2 px-2">AI agents</h2>
      <div className="space-y-0.5">{agents.map(a => <button type="button" key={a.id} aria-label={"Select " + a.label} aria-pressed={selectedAgent === a.id} disabled={!a.available || !onSelectAgent} onClick={()=>onSelectAgent?.(a.id)} title={a.available ? a.blurb : a.reason} className={`flex min-h-9 w-full items-start gap-2 rounded-md px-2 py-2 text-left text-[13px] ${selectedAgent === a.id ? "bg-accent/[.08] text-accent" : a.available ? "text-ink hover:bg-hover" : "text-muted"}`}>
        <Icon name="agent" className="mt-0.5 h-4 w-4 shrink-0 opacity-70" /><span className="min-w-0"><span className="block font-medium">{a.label}{!a.available && <span className="ml-2 text-[10px]">Unavailable</span>}{a.demo && <span className="ml-2 text-[10px]">Demo</span>}</span><span className="mt-0.5 block text-[10px] leading-4 text-muted">{a.available ? <>{a.id==="agent" ? "Workspace default · " : a.id==="muse" ? "Channel assistant · " : ""}{a.modelLabel ?? a.blurb}</> : a.reason}</span></span>
      </button>)}</div>
    </nav>}
    {showSettings && <Link className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-muted hover:bg-hover hover:text-ink" href={"/workspaces/" + workspace.id}><Icon name="settings" />Workspace settings</Link>}
    {showIdentity && <Link href="/profile" className="flex items-center gap-2.5 rounded-md border-t border-line px-2 pt-4 text-xs">
      {user.image ? <img src={user.image} alt="" className="h-7 w-7 rounded-md" referrerPolicy="no-referrer" /> : <span className="grid h-7 w-7 place-items-center rounded-md bg-white font-semibold">{user.name.slice(0, 2).toUpperCase()}</span>}
      <span className="truncate">{user.name}</span><Icon name="profile" className="ml-auto h-3.5 w-3.5 text-muted" />
    </Link>}
  </section>;
}
