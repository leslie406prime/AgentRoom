"use client";
import { useHydrated } from "@/lib/use-hydrated";
import AISettingsForm from "@/components/AISettingsForm";
import AIProvidersForm from "@/components/AIProvidersForm";
import type { getAIConfig } from "@/server/ai-workspace";
import type { getAISettings } from "@/server/ai-repository";
import ChannelManager from "@/components/ChannelManager";
import { useState } from "react";
import SettingsShell from "@/components/SettingsShell";
import WorkspaceNav from "@/components/WorkspaceNav";
import { can, type Role } from "@/server/permissions";
import type { getWorkspace } from "@/server/workspace-repository";
type Invitation={id:string;role:string;expiresAt:number;maxUses:number;uses:number;revoked:number};
export default function WorkspaceSettings({workspace,workspaces,actor,invitations,aiSettings,aiConfig}:{workspace:Awaited<ReturnType<typeof getWorkspace>>;workspaces:{id:string;name:string}[];actor:string;invitations:unknown[];aiSettings?:Awaited<ReturnType<typeof getAISettings>>;aiConfig?:Awaited<ReturnType<typeof getAIConfig>>}) {
 const ready=useHydrated();
 const [name,setName]=useState(workspace.name),[avatar,setAvatar]=useState(workspace.avatar),[role,setRole]=useState<Role>("MEMBER"),[days,setDays]=useState(7),[uses,setUses]=useState(1),[email,setEmail]=useState(""),[link,setLink]=useState(""),[error,setError]=useState(""),[confirmation,setConfirmation]=useState("");
 async function action(path:string,method:string,body:unknown,reload=true){
  setError("");const response=await fetch("/api/workspaces/"+workspace.id+path,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});const data=await response.json();
  if(!response.ok){setError(data.error??"Unable to complete request.");return null;}if(reload)window.location.reload();return data;
 }
 const self=workspace.members.find(m=>m.id===actor);
 return <SettingsShell section="workspace" workspaceId={workspace.id} title={workspace.name} description="The details, people, and preferences that keep your workspace running." navigation={<WorkspaceNav workspace={workspace} workspaces={workspaces} user={{name:self?.name??"Member",image:self?.image}} showSettings={false}/>}>
 <div inert={!ready} className="space-y-8"><div className="flex items-center gap-2 text-xs text-muted">Your role <span className="badge">{workspace.role}</span></div>{error&&<p role="alert" className="status-note text-danger">{error}</p>}
 <section className="settings-section"><div><h2>Workspace details</h2><p className="mt-2 text-xs text-muted">Give your shared space a name and an identity.</p></div>
 {can(workspace.role,"workspace:manage")&&<form className="flex flex-wrap items-end gap-3" onSubmit={async e=>{e.preventDefault();void (await action("","PATCH",{name,avatar}));}}><label>Workspace name<input aria-label="Workspace name" className="block bg-panel border border-line p-2" value={name} onChange={e=>setName(e.target.value)} maxLength={60} required/></label><label>Avatar<select className="block bg-panel border border-line p-2" value={avatar} onChange={e=>setAvatar(e.target.value)}>{workspace.avatar.endsWith(".webp")&&<option value={workspace.avatar}>Uploaded image</option>}{["violet","blue","green","orange"].map(a=><option key={a}>{a}</option>)}</select></label><button className="btn-primary">Save workspace</button></form>}
 {can(workspace.role,"workspace:manage")&&<label className="block">Upload workspace avatar (PNG, JPEG, WebP, up to 1 MB)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;const r=await fetch("/api/workspaces/"+workspace.id+"/avatar",{method:"POST",body:file});if(r.ok)window.location.reload();else setError((await r.json()).error);}}/></label>}
 </section>
 <ChannelManager workspace={workspace.id} role={workspace.role} channels={workspace.channels}/>
 <section className="settings-section"><h2 className="text-lg">Members</h2>{workspace.members.map(member=><div key={member.id} className="flex flex-wrap items-center gap-3 border-b border-line py-3 text-xs"><span className="min-w-0 flex-1 basis-40 break-words"><span className="block font-medium">{member.name??"Member"}</span><span className="mt-1 block text-[11px] text-muted">{member.email}</span></span><span className="badge">{member.role}</span>
 {can(workspace.role,"member:role",{targetRole:member.role})&&<select aria-label={"Role for "+member.name} className="bg-panel p-2" value={member.role} onChange={async e=>void (await action("/members","POST",{userId:member.id,role:e.target.value}))}>{["OWNER","ADMIN","MEMBER"].map(r=><option key={r}>{r}</option>)}</select>}
 {member.id!==actor&&can(workspace.role,"member:role")&&<button className="btn text-xs" onClick={async ()=>void (await action("/members","POST",{userId:member.id,transfer:true}))}>Transfer ownership</button>}
 {(member.id===actor||can(workspace.role,"member:remove",{targetRole:member.role}))&&<button className="btn text-danger" onClick={async()=>{const d=await action("/members","POST",{userId:member.id},false);if(d)window.location.assign(member.id===actor?"/":"/workspaces/"+workspace.id);}}>{member.id===actor?"Leave workspace":"Remove member"}</button>}
 </div>)}</section>
 {can(workspace.role,"invite")&&<section className="settings-section"><h2 className="text-lg">Invitations</h2><form className="flex flex-wrap gap-3 items-end" onSubmit={async e=>{e.preventDefault();const d=await action("/invitations","POST",{role,days,maxUses:uses,...(email?{email}:{})},false);if(d)setLink(window.location.origin+d.path);}}>
 <label>Invite role<select aria-label="Invite role" className="block bg-panel border border-line p-2" value={role} onChange={e=>setRole(e.target.value as Role)}>{["MEMBER","ADMIN","OWNER"].filter(r=>can(workspace.role,"invite",{inviteRole:r as Role})).map(r=><option key={r}>{r}</option>)}</select></label>
 <label>Expires in days<input type="number" className="block w-20 bg-panel border border-line p-2" value={days} min={1} max={30} onChange={e=>setDays(Number(e.target.value))}/></label><label>Maximum uses<input type="number" className="block w-20 bg-panel border border-line p-2" value={uses} min={1} max={100} onChange={e=>setUses(Number(e.target.value))}/></label>
 <label>Email restriction (optional)<input type="email" className="block bg-panel border border-line p-2" value={email} onChange={e=>setEmail(e.target.value)}/></label><button className="btn-primary">Create invitation</button></form>
 {link&&<div className="space-y-2"><p>Copy this link now. It cannot be retrieved again.</p><input aria-label="New invitation link" className="w-full bg-panel border border-line p-2" readOnly value={link}/><button className="btn" onClick={()=>void navigator.clipboard.writeText(link)}>Copy new invitation link</button><button className="btn ml-3" onClick={()=>window.location.reload()}>Done</button></div>}
 {(invitations as Invitation[]).map(i=><div key={i.id} className="flex gap-4 text-sm"><span>{i.role} · {i.uses}/{i.maxUses} uses · {new Date(i.expiresAt).toLocaleDateString()} {i.revoked?"Revoked":""}</span>{!i.revoked&&<button className="btn min-h-7 py-1 text-[11px]" onClick={async ()=>void (await action("/invitations","DELETE",{id:i.id}))}>Revoke</button>}</div>)}</section>}
 {aiConfig&&<AIProvidersForm workspace={workspace.id} config={aiConfig}/>}
 {aiSettings&&<AISettingsForm workspace={workspace.id} settings={aiSettings}/>}
 {can(workspace.role,"workspace:delete")&&<section className="space-y-4 rounded-md border border-danger/20 bg-red-50/30 p-5"><h2 className="text-sm font-semibold text-danger">Delete workspace</h2><label>Type {workspace.name} to confirm<input aria-label="Confirm workspace deletion" className="block bg-panel border border-line p-2" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label><button className="btn border-danger/30 text-danger hover:bg-red-50" disabled={confirmation!==workspace.name} onClick={async()=>{if(await action("","DELETE",{confirmation},false))window.location.assign("/");}}>Delete workspace permanently</button></section>}
 </div></SettingsShell>;
}
