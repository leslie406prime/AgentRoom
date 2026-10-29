"use client";
import { useHydrated } from "@/lib/use-hydrated";
import { signIn } from "next-auth/react";
import { useState } from "react";
export default function Identities({ identities, mock }: { identities: { provider: string; providerAccountId: string }[]; mock: boolean }) {
 const ready=useHydrated();
  const [error,setError]=useState("");
  const [hint,setHint]=useState("demo-user");
  async function connect(provider:string) {
    const response=await fetch("/api/profile/identities",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({provider})});
    if(!response.ok) {setError("Could not start account linking.");return;}
    await signIn(provider,{redirectTo:"/profile"},mock?{login_hint:hint}:undefined);
  }
  async function unlink(provider:string,account:string) {
    const response=await fetch("/api/profile/identities",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({provider,account})});
    const data=await response.json();
    if(!response.ok) setError(data.error); else window.location.reload();
  }
  return <section inert={!ready} className="settings-section">
    <div><h2>Connected identities</h2><p className="mt-2 text-xs leading-5 text-muted">Manage the accounts you use to sign in to AgentRoom.</p></div>
    <div className="divide-y divide-line rounded-md border border-line">{identities.map(i => <div key={i.provider+i.providerAccountId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><span className="text-sm font-medium">{i.provider === "google" ? "Google" : i.provider}</span><button className="btn text-muted" onClick={() => void unlink(i.provider,i.providerAccountId)}>Disconnect</button></div>)}</div>
    {mock && <label className="settings-label max-w-md">Mock identity<input className="field" value={hint} onChange={e => setHint(e.target.value)}/></label>}
    <div className="flex flex-wrap gap-3">{[mock ? "mock-google" : "google"].map(p => <button className="btn" key={p} onClick={() => void connect(p)}>Connect {mock ? p : "Google"}</button>)}</div>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </section>;
}
