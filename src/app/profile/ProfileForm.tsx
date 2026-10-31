"use client";
import { useHydrated } from "@/lib/use-hydrated";
import { useState } from "react";
export default function ProfileForm({name}:{name:string}) {
 const ready=useHydrated();
  const [value,setValue]=useState(name),[result,setResult]=useState("");
  async function save(e:React.FormEvent) {
    e.preventDefault(); const response=await fetch("/api/profile",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({name:value})});
    setResult(response.ok?"Profile saved.":"Use a display name between 1 and 40 characters.");
  }
  return <form inert={!ready} onSubmit={async e=>void (await save(e))} className="max-w-md space-y-4"><label className="settings-label">Display name<input className="field" value={value} onChange={e=>setValue(e.target.value)} minLength={1} maxLength={40} required/></label><button className="btn-primary">Save profile</button><p role="status" className={result === "Profile saved." ? "text-xs text-success" : "text-xs text-danger"}>{result}</p></form>;
}
