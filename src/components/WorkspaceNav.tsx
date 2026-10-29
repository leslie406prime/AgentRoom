/* eslint-disable @next/next/no-img-element */
"use client";
import { useHydrated } from "@/lib/use-hydrated";
import Link from "next/link";
import Icon from "./Icon";
import type { Role } from "@/server/permissions";

export type WorkspaceNavData = { id: string; name: string; avatar?: string; role?: Role; channels: { id: string; name: string; archived: number }[] };

export default function WorkspaceNav({ workspace, workspaces, user, activeChannelId, showIdentity = true, showSettings = true, agents = [] }: {
  workspace: WorkspaceNavData; workspaces: { id: string; name: string }[]; user: { name: string; image?: string | null };
  activeChannelId?: string; showIdentity?: boolean; showSettings?: boolean;
  agents?: { id: string; label: string; blurb: string; available: boolean; demo?: boolean; reason?: string }[];
}) {
  const ready = useHydrated();
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
      <h2 className="eyebrow mb-2 px-2">Channels <span className="ml-1 text-[10px]">{workspace.channels.length}</span></h2>
      <div className="space-y-0.5">{workspace.channels.map(c => <Link key={c.id} aria-current={activeChannelId === c.id ? "page" : undefined}
        className={`flex min-h-9 items-center gap-2 rounded-md px-2 text-[13px] transition-colors ${activeChannelId === c.id ? "bg-accent/[.08] font-medium text-accent" : "text-muted hover:bg-hover hover:text-ink"}`}
        href={"/workspaces/" + workspace.id + "/channels/" + c.id}>
        <Icon name="hash" className="h-4 w-4 shrink-0 opacity-70" /><span className="truncate">{c.name}</span>{Boolean(c.archived) && <span className="ml-auto text-[10px]">Archived</span>}
      </Link>)}</div>
    </nav>
    {agents.length > 0 && <nav aria-label="AI agents">
      <h2 className="eyebrow mb-2 px-2">AI agents</h2>
      <div className="space-y-0.5">{agents.map(a => <div key={a.id} title={a.available ? a.blurb : a.reason} className={`flex min-h-9 items-center gap-2 rounded-md px-2 text-[13px] ${a.available ? "text-ink" : "text-muted"}`}>
        <Icon name="agent" className="h-4 w-4 shrink-0 opacity-70" /><span className="truncate">{a.label}</span>{!a.available && <span className="ml-auto text-[10px]">Unavailable</span>}{a.available && a.demo && <span className="ml-auto text-[10px]">Demo</span>}
      </div>)}</div>
    </nav>}
    {showSettings && <Link className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-muted hover:bg-hover hover:text-ink" href={"/workspaces/" + workspace.id}><Icon name="settings" />Workspace settings</Link>}
    {showIdentity && <Link href="/profile" className="flex items-center gap-2.5 rounded-md border-t border-line px-2 pt-4 text-xs">
      {user.image ? <img src={user.image} alt="" className="h-7 w-7 rounded-md" referrerPolicy="no-referrer" /> : <span className="grid h-7 w-7 place-items-center rounded-md bg-white font-semibold">{user.name.slice(0, 2).toUpperCase()}</span>}
      <span className="truncate">{user.name}</span><Icon name="profile" className="ml-auto h-3.5 w-3.5 text-muted" />
    </Link>}
  </section>;
}
