"use client";

import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import Brand from "@/components/Brand";
import Icon from "@/components/Icon";

export default function SignInForm({ callbackUrl, mockEnabled, authError }: { callbackUrl: string; mockEnabled: boolean; authError?: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [identity, setIdentity] = useState("demo-user");
  const [error, setError] = useState("");

  async function begin(provider: string) {
    try {
      await signIn(provider, {
        redirectTo: callbackUrl,
      }, mockEnabled ? { login_hint: identity.trim() || "demo-user" } : undefined);
    } catch {
      setError("Sign in could not be started. Please try again.");
    }
  }

  return <main className="flex min-h-screen flex-col bg-white">
    <header className="flex h-20 items-center justify-between px-6 sm:px-10"><Brand /><span className="hidden text-xs text-muted sm:block">A shared space for great work.</span></header>
    <div className="grid flex-1 lg:grid-cols-2">
      <section className="flex items-center justify-center px-6 py-12 lg:px-12">
        <div className="w-full max-w-[380px]">
          <p className="eyebrow mb-4">Welcome to AgentRoom</p>
          <h1 className="text-[34px] font-semibold leading-[1.2] tracking-[-.04em] sm:text-[40px]">Your team. Your AI agents. One workspace.</h1>
          <p className="mt-5 text-sm leading-6 text-muted">Sign in to work together, share ideas, and move things forward.</p>
          {mockEnabled && <div className="status-note mt-6">
            Development mock OAuth is enabled. Choose a test identity:
            <input aria-label="Mock identity" value={identity} onChange={event => setIdentity(event.target.value)} maxLength={48} className="field" />
          </div>}
          <div className="mt-8 grid gap-3">
            <button disabled={!ready} onClick={async () => void (await begin(mockEnabled ? "mock-google" : "google"))} className="btn min-h-12 justify-start px-4 text-sm"><Icon name="google" className="mr-5 h-[18px] w-[18px]" />Continue with Google</button>
          </div>
          {authError && <p role="alert" className="mt-4 text-xs leading-5 text-danger">Sign in was refused. Please continue with the Google account you used before. A Google identity already used by another account cannot be connected.</p>}
          {error && <p role="alert" className="mt-4 text-xs text-danger">{error}</p>}
          <p className="mt-6 flex items-center justify-center gap-2 text-[11px] text-muted"><Icon name="shield" className="h-3.5 w-3.5" />Your account. Your Google sign-in.</p>
          <p className="mt-6 border-t border-line pt-5 text-[11px] leading-5 text-muted">Accounts are never merged by email address.</p>
        </div>
      </section>
      <aside className="hidden items-center justify-center border-l border-line bg-panel p-12 lg:flex">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex items-center gap-2 text-xs text-muted"><span className="h-1.5 w-1.5 rounded-full bg-success" />Built for working together</div>
          <div className="overflow-hidden rounded-lg border border-line bg-white">
            <div className="flex items-center gap-2 border-b border-line px-5 py-4 text-sm font-semibold"><Icon name="hash" className="h-4 w-4 text-muted" />team-workspace<span className="badge ml-auto">Preview</span></div>
            <div className="space-y-6 p-5">
              <div className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#e8edf0] text-[10px] font-semibold">JL</span><div><p className="text-xs font-semibold">Jamie <span className="ml-2 text-[10px] font-normal text-muted">10:24 AM</span></p><p className="mt-1 text-[13px] leading-6">A place for the team, the plan, and everything we create along the way.</p></div></div>
              <div className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-panel text-accent"><Icon name="agent" /></span><div><p className="flex items-center gap-2 text-xs font-semibold">Room agent <span className="badge">AI</span></p><p className="mt-1 text-[13px] leading-6">And a little help turning the next idea into the next step.</p><div className="mt-3 flex items-center gap-2 rounded-md border border-line px-3 py-2 text-xs"><Icon name="file" className="text-muted h-4 w-4" />Our next chapter.md<Icon name="check" className="ml-auto h-3.5 w-3.5 text-success" /></div></div></div>
            </div>
            <div className="m-4 mt-0 rounded-md border border-line px-3 py-3 text-xs text-muted">Message your team…</div>
          </div>
          <h2 className="mt-8 text-xl font-medium tracking-tight">Less switching. More together.</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted">Conversations, shared artifacts, and AI assistance. All in the same place.</p>
        </div>
      </aside>
    </div>
    <footer className="flex items-center justify-between border-t border-line px-6 py-5 text-[11px] text-muted sm:px-10"><span>AgentRoom</span><span>Good work starts with a shared space.</span></footer>
  </main>;
}
