/* eslint-disable @next/next/no-img-element -- Provider profile images use existing OAuth URLs. */
"use client";
import { useHydrated } from "@/lib/use-hydrated";
import WorkspaceList from "@/components/WorkspaceList";
import LegacyRoomLink from "@/components/LegacyRoomLink";
import { signOut } from "next-auth/react";
import type { HomeWorkspace } from "@/server/workspace-repository";

import { useState } from "react";
import Link from "next/link";
import Brand from "@/components/Brand";
import Icon from "@/components/Icon";

export default function HomeClient({ user, workspaces }: { user: { name: string; image?: string | null } | null; workspaces: HomeWorkspace[] }) {
 const ready=useHydrated();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedWorkspace, setSelectedWorkspace] = useState(workspaces[0]?.id ?? "");
  const activeWorkspace = workspaces.find(workspace => workspace.id === selectedWorkspace) ?? workspaces[0];

  async function createRoom() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Team workspace" }) });
      const data = await response.json() as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error ?? "Could not create your room");
      window.location.assign(`/room/${data.id}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create your room"); setBusy(false); }
  }

  return <main className="min-h-screen bg-white">
    <header className="border-b border-line"><nav className="mx-auto flex h-20 max-w-6xl items-center justify-between px-6 lg:px-10"><Brand /><div className="flex items-center gap-6"><span className="hidden text-xs text-muted sm:block">A little more together.</span>{user ? <details className="relative"><summary aria-label={"Account for " + user.name} className="flex cursor-pointer list-none items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover">
      {user.image ? <img src={user.image} alt={user.name + "'s profile picture"} referrerPolicy="no-referrer" className="h-8 w-8 rounded-md object-cover" /> : <span className="grid h-8 w-8 place-items-center rounded-md border border-line bg-panel text-[10px] font-semibold">{user.name.slice(0,2).toUpperCase()}</span>}
      <span className="max-w-32 truncate text-xs font-medium sm:max-w-48">{user.name}</span><Icon name="chevron" className="h-3.5 w-3.5 text-muted" /></summary><div className="absolute right-0 z-20 mt-2 w-48 rounded-md border border-line bg-white p-1.5"><Link href="/profile" className="flex items-center gap-2 rounded px-3 py-2 text-xs hover:bg-hover"><Icon name="profile" />Profile settings</Link><button disabled={!ready} onClick={() => void signOut({ callbackUrl: "/" })} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs hover:bg-hover"><Icon name="logout" />Sign out</button></div></details> : <Link href="/sign-in" className="btn">Sign in<Icon name="arrow" className="h-3.5 w-3.5" /></Link>}</div></nav></header>
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[1fr_1fr] lg:gap-16 lg:px-10 lg:py-24">
      <div><p className="eyebrow mb-5">The shared workspace for people & AI</p><h1 className="max-w-lg text-4xl font-semibold leading-[1.12] tracking-[-.045em] sm:text-5xl">Make room for<br />better work.</h1><p className="mt-6 max-w-md text-base leading-7 text-muted">Your team, your conversations, and your AI agents. Together in a focused workspace that keeps the work moving.</p>
        <div className="mt-8 flex flex-wrap items-end gap-3">{!user ? <Link href="/sign-in" className="btn-primary min-h-11 px-5 text-sm">Get started<Icon name="arrow" /></Link> : <>
          {activeWorkspace && <>{workspaces.length > 1 && <label className="min-w-0 max-w-full text-xs text-muted">Choose workspace<select disabled={!ready} aria-label="Choose workspace" className="field mt-1 max-w-60" value={activeWorkspace.id} onChange={event => setSelectedWorkspace(event.target.value)}>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>}<Link href={"/workspaces/" + activeWorkspace.id + "/channels/" + activeWorkspace.channelId} className="btn-primary min-h-11 px-5 text-sm">Open workspace<Icon name="arrow" /></Link></>}
          <button onClick={createRoom} disabled={!ready || busy} className={activeWorkspace ? "btn min-h-11 px-4 text-sm" : "btn-primary min-h-11 px-5 text-sm"}>{busy ? "Creating your workspace…" : activeWorkspace ? "Create another workspace" : "Create a workspace"}<Icon name="plus" className="h-3.5 w-3.5" /></button>
        </>}</div>
        {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
        <div className="mt-10 flex flex-wrap items-center gap-5 text-[11px] text-muted"><span className="flex items-center gap-1.5"><Icon name="chat" className="h-3.5 w-3.5" />Shared conversations</span><span className="flex items-center gap-1.5"><Icon name="agent" className="h-3.5 w-3.5" />AI, in context</span><span className="flex items-center gap-1.5"><Icon name="file" className="h-3.5 w-3.5" />Work that stays</span></div>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line bg-panel px-5 py-4"><span className="flex items-center gap-2 text-xs font-semibold"><Icon name="hash" />launch-planning</span><span className="badge">Preview</span></div>
        <div className="grid grid-cols-[110px_minmax(0,1fr)] sm:grid-cols-[125px_minmax(0,1fr)]"><div className="border-r border-line bg-panel px-3 py-5"><p className="eyebrow text-[9px]">Channels</p><div className="mt-3 space-y-2 text-[10px] text-muted"><p># general</p><p className="-mx-1 rounded bg-accent/[.08] px-1 py-1.5 font-medium text-accent"># launch-planning</p><p># ideas</p></div><p className="eyebrow mt-8 text-[9px]">AI agents</p><p className="mt-3 flex items-center gap-1 text-[10px] text-muted"><Icon name="agent" className="h-3 w-3" />Room agent</p></div>
          <div className="min-w-0 p-5"><div className="flex gap-2.5"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#e8edf0] text-[9px] font-medium">JD</span><div><p className="text-[11px] font-semibold">Jamie <span className="ml-1 text-[9px] font-normal text-muted">2:14 PM</span></p><p className="mt-1 text-xs leading-6">Let&apos;s bring the launch plan together.</p></div></div>
            <div className="mt-5 flex gap-2.5"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line bg-panel text-accent"><Icon name="agent" className="h-3.5 w-3.5" /></span><div className="min-w-0"><p className="text-[11px] font-semibold">Room agent <span className="badge ml-1">AI</span></p><p className="mt-1 text-xs leading-6">Here&apos;s a shared starting point for the team.</p><div className="mt-3 flex items-center gap-2 rounded-md border border-line p-3 text-[11px]"><Icon name="file" className="h-3.5 w-3.5 text-muted" />Launch plan.md<Icon name="check" className="ml-auto h-3 w-3 text-success" /></div></div></div>
            <div className="mt-7 flex items-center justify-between rounded-md border border-line p-3 text-[10px] text-muted">Message your team…<Icon name="send" className="h-3 w-3" /></div>
          </div>
        </div>
      </div>
    </section>
    {user && <section className="mx-auto max-w-6xl px-6 pb-16 lg:px-10"><div className="border-t border-line pt-8"><h2 className="mb-4 text-sm font-semibold">Your workspaces</h2>{workspaces.length ? <WorkspaceList workspaces={workspaces} /> : <p className="text-sm text-muted">Create your first workspace or open an original room link below.</p>}<LegacyRoomLink /></div></section>}
    <footer className="mx-auto flex max-w-6xl justify-between border-t border-line px-6 py-6 text-[11px] text-muted lg:px-10"><span>AgentRoom</span><span>Built for the way teams think.</span></footer>
  </main>;
}
