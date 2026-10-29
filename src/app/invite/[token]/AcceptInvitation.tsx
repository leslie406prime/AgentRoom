"use client";
import { useHydrated } from "@/lib/use-hydrated";
import { useState } from "react";
export default function AcceptInvitation({token}:{token:string}) {
 const ready=useHydrated();
 const [error,setError]=useState("");
 async function accept(){const r=await fetch("/api/invitations/"+encodeURIComponent(token),{method:"POST"});const d=await r.json();if(!r.ok){setError("This invitation is unavailable. Ask the inviter for a new link.");return;}window.location.assign("/workspaces/"+d.workspaceId+"/channels/"+d.channelId);}
 return <section inert={!ready} className="mt-6 space-y-4 text-sm text-muted"><p>Accept this invitation to join the workspace.</p><button className="btn-primary" onClick={()=>void accept()}>Accept invitation</button>{error&&<p role="alert" className="text-xs text-danger">{error}</p>}</section>;
}
