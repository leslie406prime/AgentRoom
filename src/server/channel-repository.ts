import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { channelScope,requireRole,audit } from "./workspace-repository";
import { HttpError } from "./http-security";
export const ChannelName=z.string().trim().toLowerCase().transform(value=>value.replace(/\s+/g,"-")).pipe(z.string().min(1).max(64).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/));
export const NewChannel=z.object({name:ChannelName}).strict();
export const EditChannel=z.object({name:ChannelName.optional(),archived:z.boolean().optional()}).strict().refine(value=>value.name!==undefined||value.archived!==undefined);
export async function createChannel(actor:string,workspace:string,input:unknown){
 const parsed=NewChannel.parse(input);
 return (await db.transaction(async ()=>{
  (await requireRole(actor,workspace,"channel:manage"));
  if((await db.prepare("SELECT 1 FROM channels WHERE workspace_id=? AND name=?").get(workspace,parsed.name)))throw new HttpError(409,"A channel with that name already exists.");
  const id=randomUUID();(await db.prepare("INSERT INTO rooms(id,name) VALUES (?,?)").run(id,parsed.name));(await db.prepare("INSERT INTO channels(id,workspace_id,name) VALUES (?,?,?)").run(id,workspace,parsed.name));(await audit(workspace,actor,"channel:create",{id}));return {id};
 }).immediate());
}
async function editableChannel(actor:string,workspace:string,channel:string){
 (await channelScope(actor,workspace,channel));(await requireRole(actor,workspace,"channel:manage"));
 const row=(await db.prepare("SELECT is_general FROM channels WHERE workspace_id=? AND id=?").get(workspace,channel)) as {is_general:number};
 if(row.is_general)throw new HttpError(409,"The general channel cannot be renamed, archived or deleted.");
}
export async function updateChannel(actor:string,workspace:string,channel:string,input:unknown){
 const parsed=EditChannel.parse(input);
 (await db.transaction(async ()=>{
  (await editableChannel(actor,workspace,channel));
  if(parsed.name!==undefined){if((await db.prepare("SELECT 1 FROM channels WHERE workspace_id=? AND name=? AND id<>?").get(workspace,parsed.name,channel)))throw new HttpError(409,"A channel with that name already exists.");(await db.prepare("UPDATE channels SET name=? WHERE workspace_id=? AND id=?").run(parsed.name,workspace,channel));(await db.prepare("UPDATE rooms SET name=? WHERE id=?").run(parsed.name,channel));}
  if(parsed.archived!==undefined)(await db.prepare("UPDATE channels SET archived=? WHERE workspace_id=? AND id=?").run(parsed.archived?1:0,workspace,channel));
  (await audit(workspace,actor,"channel:update",{channel,...parsed}));
 }).immediate());
}
export async function deleteChannel(actor:string,workspace:string,channel:string){
 (await db.transaction(async ()=>{(await editableChannel(actor,workspace,channel));(await audit(workspace,actor,"channel:delete",{channel}));(await db.prepare("DELETE FROM rooms WHERE id=?").run(channel));}).immediate());
}
