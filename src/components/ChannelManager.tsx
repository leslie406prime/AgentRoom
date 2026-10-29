"use client";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { can,type Role } from "@/server/permissions";
type Channel={id:string;name:string;archived:number;isGeneral:number};
function ChannelRow({workspace,channel}:{workspace:string;channel:Channel}){
 const [name,setName]=useState(channel.name),[error,setError]=useState("");
 async function change(method:string,input?:unknown){
  const r=await fetch("/api/workspaces/"+workspace+"/channels/"+channel.id,{method,headers:{"content-type":"application/json"},...(input?{body:JSON.stringify(input)}:{})});
  if(r.ok)window.location.reload();else setError((await r.json()).error);
 }
 if(channel.isGeneral)return <p className="status-note">#general is permanent.</p>;
 return <div className="space-y-2"><form onSubmit={e=>{e.preventDefault();void change("PATCH",{name});}} className="flex flex-wrap items-end gap-3"><input aria-label={"Name for "+channel.name} className="bg-panel border border-line p-2" value={name} onChange={e=>setName(e.target.value)} maxLength={64}/><button className="btn">Rename</button><button className="btn" type="button" onClick={()=>void change("PATCH",{archived:!channel.archived})}>{channel.archived?"Unarchive":"Archive"}</button><button className="btn" type="button" onClick={()=>{if(window.confirm("Delete #"+channel.name+" and its history?"))void change("DELETE");}}>Delete channel</button></form>{error&&<p role="alert" className="text-xs text-danger">{error}</p>}</div>;
}
export default function ChannelManager({workspace,role,channels}:{workspace:string;role:Role;channels:Channel[]}){
 const ready=useHydrated(),[name,setName]=useState(""),[error,setError]=useState("");
 if(!can(role,"channel:manage"))return null;
 return <section inert={!ready} className="settings-section"><h2 className="text-lg">Manage channels</h2><form onSubmit={async e=>{e.preventDefault();const r=await fetch("/api/workspaces/"+workspace+"/channels",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name})});const data=await r.json();if(r.ok)window.location.assign("/workspaces/"+workspace+"/channels/"+data.id);else setError(data.error);}} className="flex flex-wrap items-end gap-3"><label>New channel name<input aria-label="New channel name" className="block bg-panel border border-line p-2" value={name} onChange={e=>setName(e.target.value)} maxLength={64} required/></label><button className="btn-primary">Create channel</button></form>{error&&<p role="alert" className="text-xs text-danger">{error}</p>}{channels.map(c=><ChannelRow key={c.id} workspace={workspace} channel={c}/>)}</section>;
}
