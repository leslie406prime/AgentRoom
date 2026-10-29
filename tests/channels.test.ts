import { expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { createWorkspace,createInvitation,acceptInvitation } from "../src/server/workspace-repository";
import { createChannel,deleteChannel,updateChannel } from "../src/server/channel-repository";
import { channelSnapshot,joinMember,saveChannelArtifact,sendChannelMessage } from "../src/server/collaboration-repository";
function user(){const id=randomUUID();db.prepare('INSERT INTO "user"(id,name,created_at) VALUES (?,?,?)').run(id,"User",Date.now());return id;}
it("normalizes channels, enforces uniqueness and protects general",()=>{
 const actor=user(),w=createWorkspace(actor,{name:"Channels"});const c=createChannel(actor,w.id,{name:"  Project Ideas  "});expect(channelSnapshot(actor,w.id,c.id).room.name).toBe("project-ideas");expect(()=>createChannel(actor,w.id,{name:"project-ideas"})).toThrow("already exists");
 expect(()=>updateChannel(actor,w.id,w.channelId,{name:"other"})).toThrow("general");expect(()=>updateChannel(actor,w.id,w.channelId,{archived:true})).toThrow("general");expect(()=>deleteChannel(actor,w.id,w.channelId)).toThrow("general");
 for(const name of ["!bad","a".repeat(65),"--bad"])expect(()=>createChannel(actor,w.id,{name})).toThrow();
});
it("scopes snapshots, messages, artifacts and channels at the repository boundary",()=>{
 const actor=user(),outsider=user(),w=createWorkspace(actor,{name:"Isolation"}),other=createWorkspace(outsider,{name:"Other"});joinMember(actor,w.id,w.channelId);
 for(const [person,workspace,channel] of [[outsider,w.id,w.channelId],[actor,w.id,other.channelId],[actor,other.id,other.channelId]]){
  expect(()=>channelSnapshot(person,workspace,channel,0)).toThrow();expect(()=>sendChannelMessage(person,workspace,channel,{clientId:randomUUID(),content:"forbidden"})).toThrow();expect(()=>saveChannelArtifact(person,workspace,channel,{title:"Forbidden",type:"document",language:"markdown",content:"secret",version:0})).toThrow();
 }
 expect(channelSnapshot(actor,w.id,w.channelId).messages).toEqual([]);expect(channelSnapshot(actor,w.id,w.channelId).artifacts).toEqual([]);
});
it("returns a durable sequence for repeated reconnect and enforces archived read-only channels",()=>{
 const actor=user(),w=createWorkspace(actor,{name:"Replay"}),c=createChannel(actor,w.id,{name:"research"});joinMember(actor,w.id,c.id);const sent=sendChannelMessage(actor,w.id,c.id,{clientId:randomUUID(),content:"Saved"});
 const snapshot=channelSnapshot(actor,w.id,c.id);expect(snapshot.seq).toBe(sent.seq);expect(channelSnapshot(actor,w.id,c.id,snapshot.seq).replay).toEqual([]);
 updateChannel(actor,w.id,c.id,{archived:true});expect(channelSnapshot(actor,w.id,c.id).messages).toHaveLength(1);expect(()=>sendChannelMessage(actor,w.id,c.id,{clientId:randomUUID(),content:"blocked"})).toThrow();
});
it("restricts channel management to owners/admins",()=>{
 const owner=user(),member=user(),w=createWorkspace(owner,{name:"Roles"}),inv=createInvitation(owner,w.id,{});acceptInvitation(member,inv.path.split("/").at(-1)!);expect(()=>createChannel(member,w.id,{name:"no"})).toThrow("not allowed");
});
