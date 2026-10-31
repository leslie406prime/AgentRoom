import { expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { createWorkspace,createInvitation,acceptInvitation } from "../src/server/workspace-repository";
import { createChannel,deleteChannel,updateChannel } from "../src/server/channel-repository";
import { channelSnapshot,joinMember,saveChannelArtifact,sendChannelMessage } from "../src/server/collaboration-repository";
async function user(){const id=randomUUID();(await db.prepare('INSERT INTO "user"(id,name,created_at) VALUES (?,?,?)').run(id,"User",Date.now()));return id;}
it("normalizes channels, enforces uniqueness and protects general",async ()=>{
 const actor=(await user()),w=(await createWorkspace(actor,{name:"Channels"}));const c=(await createChannel(actor,w.id,{name:"  Project Ideas  "}));expect((await channelSnapshot(actor,w.id,c.id)).room.name).toBe("project-ideas");(await expect((async () => (await createChannel(actor,w.id,{name:"project-ideas"})))()).rejects.toThrow("already exists"));
 (await expect((async () => (await updateChannel(actor,w.id,w.channelId,{name:"other"})))()).rejects.toThrow("general"));(await expect((async () => (await updateChannel(actor,w.id,w.channelId,{archived:true})))()).rejects.toThrow("general"));(await expect((async () => (await deleteChannel(actor,w.id,w.channelId)))()).rejects.toThrow("general"));
 for(const name of ["!bad","a".repeat(65),"--bad"])(await expect((async () => (await createChannel(actor,w.id,{name})))()).rejects.toThrow());
});
it("scopes snapshots, messages, artifacts and channels at the repository boundary",async ()=>{
 const actor=(await user()),outsider=(await user()),w=(await createWorkspace(actor,{name:"Isolation"})),other=(await createWorkspace(outsider,{name:"Other"}));(await joinMember(actor,w.id,w.channelId));
 for(const [person,workspace,channel] of [[outsider,w.id,w.channelId],[actor,w.id,other.channelId],[actor,other.id,other.channelId]]){
  (await expect((async () => (await channelSnapshot(person,workspace,channel,0)))()).rejects.toThrow());(await expect((async () => (await sendChannelMessage(person,workspace,channel,{clientId:randomUUID(),content:"forbidden"})))()).rejects.toThrow());(await expect((async () => (await saveChannelArtifact(person,workspace,channel,{title:"Forbidden",type:"document",language:"markdown",content:"secret",version:0})))()).rejects.toThrow());
 }
 expect((await channelSnapshot(actor,w.id,w.channelId)).messages).toEqual([]);expect((await channelSnapshot(actor,w.id,w.channelId)).artifacts).toEqual([]);
});
it("returns a durable sequence for repeated reconnect and enforces archived read-only channels",async ()=>{
 const actor=(await user()),w=(await createWorkspace(actor,{name:"Replay"})),c=(await createChannel(actor,w.id,{name:"research"}));(await joinMember(actor,w.id,c.id));const sent=(await sendChannelMessage(actor,w.id,c.id,{clientId:randomUUID(),content:"Saved"}));
 const snapshot=(await channelSnapshot(actor,w.id,c.id));expect(snapshot.seq).toBe(sent.seq);expect((await channelSnapshot(actor,w.id,c.id,snapshot.seq)).replay).toEqual([]);
 (await updateChannel(actor,w.id,c.id,{archived:true}));expect((await channelSnapshot(actor,w.id,c.id)).messages).toHaveLength(1);(await expect((async () => (await sendChannelMessage(actor,w.id,c.id,{clientId:randomUUID(),content:"blocked"})))()).rejects.toThrow());
});
it("restricts channel management to owners/admins",async ()=>{
 const owner=(await user()),member=(await user()),w=(await createWorkspace(owner,{name:"Roles"})),inv=(await createInvitation(owner,w.id,{}));(await acceptInvitation(member,inv.path.split("/").at(-1)!));(await expect((async () => (await createChannel(member,w.id,{name:"no"})))()).rejects.toThrow("not allowed"));
});
