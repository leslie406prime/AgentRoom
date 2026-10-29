"use client";
import { useState } from "react";
import { legacyRoomPath } from "@/lib/legacy-room-link";
import { useHydrated } from "@/lib/use-hydrated";

export default function LegacyRoomLink() {
  const ready = useHydrated();
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  return <section className="mt-8 max-w-xl border-t border-line pt-6">
    <h2 className="text-sm font-semibold">Open a previous conversation</h2>
    <p className="mt-2 text-xs leading-5 text-muted">Have a room from before workspaces? Open its original private link to claim it for this account. Rooms already claimed by someone else require a workspace invitation.</p>
    <form onSubmit={event => {
      event.preventDefault();
      const destination = legacyRoomPath(link, window.location.origin);
      if (!destination) { setError("Enter an original /room/ link from this AgentRoom site."); return; }
      setError("");
      window.location.assign(destination);
    }} className="mt-4 flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 basis-64 text-xs font-medium">Original room link<input disabled={!ready} className="field" value={link} onChange={event => setLink(event.target.value)} autoComplete="off" spellCheck={false} required placeholder="/room/your-original-room-id" /></label>
      <button disabled={!ready} className="btn min-h-10">Open previous conversation</button>
    </form>
    {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
  </section>;
}
