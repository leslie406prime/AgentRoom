import { selectAgentTarget, completeUsage, enforceRequestLimits } from "./ai-repository";
import { agentInfo, type AgentId } from "../lib/ai-catalog";
﻿import { z } from "zod";
import { nanoid } from "nanoid";
import { db,colors,emitPersisted,eventAfter } from "./db";
import { channelScope,audit } from "./workspace-repository";
import { HttpError } from "./http-security";
import { ArtifactOutput,submitJob } from "./queue";
import { MessageInput,AgentInput,ArtifactInput } from "./collaboration-input";
import type { Action } from "./permissions";
import type { AgentJob,ArtifactRow } from "./collaboration-types";
import {requireJobLease} from "./worker-leases";
export async function channelMember(actor:string,workspace:string,channel:string,memberId?:string,action:Action="write"){
 (await channelScope(actor,workspace,channel,action));
 const member=(await db.prepare("SELECT id,name,color FROM members WHERE room_id=? AND user_id=?").get(channel,actor)) as {id:string;name:string;color:string}|undefined;
 if(!member || (memberId&&member.id!==memberId))throw new HttpError(404,"Not found.");return member;
}
export async function joinMember(actor:string,workspace:string,channel:string){
 return (await db.transaction(async ()=>{
  (await channelScope(actor,workspace,channel));
  const user=(await db.prepare('SELECT name FROM "user" WHERE id=?').get(actor)) as {name:string|null}|undefined;
  if(!user)throw new HttpError(404,"Not found.");
  const name=(user.name?.trim()||"AgentRoom member").slice(0,40);
  const prior=(await db.prepare("SELECT id,color FROM members WHERE room_id=? AND user_id=?").get(channel,actor)) as {id:string;color:string}|undefined;
  const id=prior?.id??nanoid(16),color=prior?.color??colors[[...id].reduce((s,c)=>s+c.charCodeAt(0),0)%colors.length];
  if(prior)(await db.prepare("UPDATE members SET name=?,last_seen=? WHERE room_id=? AND id=?").run(name,new Date().toISOString(),channel,id));
  else (await db.prepare("INSERT INTO members(id,room_id,name,color,user_id) VALUES (?,?,?,?,?)").run(id,channel,name,color,actor));
  return {id,name,color};
 }).immediate());
}
export async function channelSnapshot(actor:string,workspace:string,channel:string,lastSeq=0){
 const access=(await channelScope(actor,workspace,channel));z.number().int().nonnegative().parse(lastSeq);
 const room=(await db.prepare("SELECT id,name,next_seq AS seq FROM rooms WHERE id=?").get(channel)) as {id:string;name:string;seq:number};
 const messages=(await db.prepare("SELECT id,author_id AS authorId,author_name AS authorName,content,kind,created_at AS createdAt,seq,job_id AS jobId,ai_mode AS mode,ai_agent AS agent,ai_provider AS provider,ai_model AS model FROM messages WHERE room_id=? ORDER BY seq").all(channel));
 const members=(await db.prepare('SELECT m.id,m.name,m.color,m.last_seen AS lastSeen,u.image FROM members m LEFT JOIN "user" u ON u.id=m.user_id WHERE m.room_id=? AND (m.user_id IS NULL OR EXISTS (SELECT 1 FROM memberships w WHERE w.workspace_id=? AND w.user_id=m.user_id)) ORDER BY m.created_at').all(channel,workspace)) as {id:string;name:string;color:string;lastSeen:string;image:string|null;online?:boolean}[];
 const jobs=(await db.prepare("SELECT id,requester_id AS requesterId,requester_name AS requesterName,prompt,status,error,model,agent,provider,created_at AS createdAt FROM agent_jobs WHERE room_id=? AND status IN ('queued','running','failed') ORDER BY enqueue_order").all(channel));
 const artifacts=(await db.prepare("SELECT id,title,type,language,content,version,updated_by AS updatedBy,updated_at AS updatedAt FROM artifacts WHERE room_id=? ORDER BY updated_at DESC").all(channel));
 const versions=(await db.prepare("SELECT artifact_id AS artifactId,version,title,type,language,content,updated_by AS updatedBy,updated_at AS updatedAt FROM artifact_versions WHERE room_id=? ORDER BY artifact_id,version DESC").all(channel));
 return {room:{...room,archived:access.archived},seq:room.seq,messages,members,jobs,artifacts,versions,replay:(await eventAfter(channel,lastSeq))};
}
export async function sendChannelMessage(actor:string,workspace:string,channel:string,input:unknown){
 const parsed=MessageInput.parse(input);
 return (await db.transaction(async ()=>{
  const member=(await channelMember(actor,workspace,channel));
  const prior=(await db.prepare("SELECT seq FROM messages WHERE room_id=? AND id=?").get(channel,parsed.clientId)) as {seq:number}|undefined;
  if(prior)return {duplicate:true,seq:prior.seq};
  const payload={id:parsed.clientId,authorId:member.id,authorName:member.name,content:parsed.content,kind:"human",createdAt:new Date().toISOString()};
  const event=(await emitPersisted(channel,"message",payload));
  (await db.prepare("INSERT INTO messages(id,room_id,author_id,author_name,content,kind,created_at,seq) VALUES (?,?,?,?,?,'human',?,?)").run(payload.id,channel,member.id,member.name,payload.content,payload.createdAt,event.seq));
  return {duplicate:false,event,seq:event.seq};
 }).immediate());
}
export async function enqueueChannelAgent(actor:string,workspace:string,channel:string,input:unknown){
 const parsed=AgentInput.parse(input);
 return (await db.transaction(async ()=>{
  const member=(await channelMember(actor,workspace,channel,undefined,"agent"));
  const target=(await selectAgentTarget(actor,workspace,{agent:parsed.agent,model:parsed.model}));
  const result=(await submitJob({roomId:channel,memberId:member.id,prompt:parsed.prompt,idempotencyKey:parsed.idempotencyKey,model:target.model??undefined,agent:target.agent,provider:target.provider}));
  if(!result.duplicate)(await enforceRequestLimits(actor,workspace));
  let messageEvent;
  if(!result.duplicate){const message={id:nanoid(16),authorId:member.id,authorName:member.name,content:parsed.prompt,kind:"request",createdAt:new Date().toISOString(),jobId:result.job.id};messageEvent=(await emitPersisted(channel,"message",message));(await db.prepare("INSERT INTO messages(id,room_id,author_id,author_name,content,kind,created_at,seq,job_id) VALUES (?,?,?,?,?,'request',?,?,?)").run(message.id,channel,member.id,member.name,parsed.prompt,message.createdAt,messageEvent.seq,result.job.id));}
  return {result,messageEvent};
 }).immediate());
}
// Internal worker entry points accept channel IDs from persisted jobs, never browser input.
export async function workerChannel(channel:string){
 const row=(await db.prepare("SELECT c.id,c.workspace_id AS workspaceId,r.name FROM channels c JOIN workspaces w ON w.id=c.workspace_id JOIN rooms r ON r.id=c.id WHERE c.id=? AND c.visibility='public' AND w.unclaimed_legacy=0").get(channel)) as {id:string;workspaceId:string;name:string}|undefined;
 if(!row)throw new HttpError(404,"Not found.");return row;
}
export async function jobContext(job:AgentJob){
 const room=(await workerChannel(job.room_id));
 const history=(await db.prepare("SELECT author_name AS authorName,kind,content FROM messages WHERE room_id=? AND (job_id IS NULL OR job_id<>?) ORDER BY seq DESC LIMIT 50").all(job.room_id,job.id)).reverse() as {authorName:string;kind:string;content:string}[];
 return {room,history};
}
export type AgentMeta={agent:AgentId;provider:string|null;model:string|null};
export async function persistAgentResponse(job:AgentJob,response:string,mode:string,usage?:{prompt_tokens:number;completion_tokens:number},meta:AgentMeta={agent:"agent",provider:null,model:null}){
 return (await db.transaction(async ()=>{
  await requireJobLease(job.id);
  if(await hasAgentResponse(job))throw new HttpError(409,"This job already has a saved response.");
  const workspace=(await workerChannel(job.room_id)).workspaceId,authorName=agentInfo[meta.agent].label;
  const message={mode,id:nanoid(16),authorId:"agent",authorName,content:response,kind:"agent",createdAt:new Date().toISOString(),jobId:job.id,agent:meta.agent,provider:meta.provider,model:meta.model};
  const event=(await emitPersisted(job.room_id,"message",message));
  (await db.prepare("INSERT INTO messages(id,room_id,author_id,author_name,content,kind,created_at,seq,job_id,ai_mode,ai_agent,ai_provider,ai_model) VALUES (?,?,'agent',?,?,'agent',?,?,?,?,?,?,?)").run(message.id,job.room_id,authorName,response,message.createdAt,event.seq,job.id,mode,meta.agent,meta.provider,meta.model));
  (await completeUsage(workspace,job.id,usage));return event;
 }).immediate());
}
export async function queuedChannels(){return (await db.prepare("SELECT DISTINCT j.room_id AS roomId FROM agent_jobs j JOIN channels c ON c.id=j.room_id JOIN workspaces w ON w.id=c.workspace_id WHERE j.status IN ('queued','running') AND w.unclaimed_legacy=0").all()) as {roomId:string}[];}
export async function markOffline(channel:string,memberId:string){(await db.prepare("UPDATE members SET last_seen=? WHERE room_id=? AND id=?").run(new Date().toISOString(),channel,memberId));}

export async function saveWorkerArtifact(roomId: string, artifact: z.infer<typeof ArtifactOutput>, editor: string, id?: string, jobId?:string) {
  return (await db.transaction(async () => {
  if(jobId)await requireJobLease(jobId);
  (await workerChannel(roomId));
  const existing = id
    ? (await db.prepare("SELECT * FROM artifacts WHERE room_id = ? AND id = ?").get(roomId, id)) as ArtifactRow | undefined
    : undefined;
  const sameTitle = !id ? (await db.prepare("SELECT * FROM artifacts WHERE room_id = ? AND title = ?").get(roomId, artifact.title)) as ArtifactRow | undefined : undefined;
  const current = existing ?? sameTitle;
  const artifactId = current ? String(current.id) : id ?? nanoid(16);
  const nextVersion = current ? Number(current.version) + 1 : 1;
  const updatedAt = new Date().toISOString();
  const { event } = (await db.transaction(async () => {
    if (current) {
      (await db.prepare("INSERT INTO artifact_versions (room_id, artifact_id, version, title, type, language, content, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(roomId, artifactId, current.version, current.title, current.type, current.language, current.content, current.updated_by, current.updated_at));
      (await db.prepare("UPDATE artifacts SET title = ?, type = ?, language = ?, content = ?, version = ?, updated_by = ?, updated_at = ? WHERE room_id = ? AND id = ?")
        .run(artifact.title, artifact.type, artifact.language, artifact.content, nextVersion, editor, updatedAt, roomId, artifactId));
    } else {
      (await db.prepare("INSERT INTO artifacts (id, room_id, title, type, language, content, version, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(artifactId, roomId, artifact.title, artifact.type, artifact.language, artifact.content, nextVersion, editor, updatedAt));
    }
    const saved = (await db.prepare("SELECT id, title, type, language, content, version, updated_by AS updatedBy, updated_at AS updatedAt FROM artifacts WHERE room_id = ? AND id = ?").get(roomId, artifactId));
    const event = (await emitPersisted(roomId, "artifact", saved));
    return { event };
  }).immediate());
  return event;
  }).immediate());
}

export async function saveChannelArtifact(actor:string,workspace:string,channel:string,input:unknown){
 const parsed=ArtifactInput.parse(input);
 return (await db.transaction(async ()=>{
  const member=(await channelMember(actor,workspace,channel,undefined,"artifact"));
  const current=parsed.id?(await db.prepare("SELECT version FROM artifacts WHERE room_id=? AND id=?").get(channel,parsed.id)) as {version:number}|undefined:undefined;
  if(parsed.id&&!current&&parsed.version!==0)throw new HttpError(404,"This artifact no longer exists.");
  if(current&&!parsed.overwrite&&current.version!==parsed.version)throw new HttpError(409,"This artifact changed while you were editing. Reload or overwrite the latest version.");
  return (await saveWorkerArtifact(channel,parsed,member.name,parsed.id));
 }).immediate());
}
export async function restoreChannelArtifact(actor:string,workspace:string,channel:string,artifactId:string,version:number){
 return (await db.transaction(async ()=>{
  const member=(await channelMember(actor,workspace,channel,undefined,"artifact"));
  z.string().min(8).max(80).parse(artifactId);z.number().int().positive().parse(version);
  const prior=(await db.prepare("SELECT title,type,language,content FROM artifact_versions WHERE room_id=? AND artifact_id=? AND version=?").get(channel,artifactId,version));
  if(!prior)throw new HttpError(404,"That version could not be found.");
  return (await saveWorkerArtifact(channel,ArtifactOutput.parse(prior),member.name,artifactId));
 }).immediate());
}

export async function hasAgentResponse(job:AgentJob){(await workerChannel(job.room_id));return Boolean((await db.prepare("SELECT 1 FROM messages WHERE room_id=? AND job_id=? AND kind='agent'").get(job.room_id,job.id)));}
export async function deleteChannelMessage(actor:string,workspace:string,channel:string,messageId:string){
 z.string().min(8).max(100).parse(messageId);
 return (await db.transaction(async ()=>{
  (await channelScope(actor,workspace,channel,"moderate"));
  if(!(await db.prepare("SELECT 1 FROM messages WHERE room_id=? AND id=?").get(channel,messageId)))throw new HttpError(404,"Not found.");
  (await db.prepare("DELETE FROM messages WHERE room_id=? AND id=?").run(channel,messageId));
  const events=(await db.prepare("SELECT seq,payload FROM room_events WHERE room_id=? AND type='message'").all(channel)) as {seq:number;payload:string}[];
  for(const event of events)if((JSON.parse(event.payload) as {id?:string}).id===messageId)(await db.prepare("UPDATE room_events SET type='message:deleted',payload=? WHERE room_id=? AND seq=?").run(JSON.stringify({id:messageId}),channel,event.seq));
  (await audit(workspace,actor,"message:delete",{messageId,channel}));return (await emitPersisted(channel,"message:deleted",{id:messageId}));
 }).immediate());
}
