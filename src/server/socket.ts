import { touchUser } from "./profile-repository";
import { publicAIConfig } from "./ai-repository";
﻿import { z } from "zod";
import type { Server,Socket } from "socket.io";
import { cancelJob,ensureWorker,listQueueJobs } from "./queue";
import { findSession,sessionCookieName } from "./auth-repository";
import { registerSessionSocket,unregisterSessionSocket } from "./session-sockets";
import { trackWorkspaceSocket } from "./workspace-sockets";
import { channelForActor } from "./workspace-repository";
import { channelMember,channelSnapshot,enqueueChannelAgent,joinMember,markOffline,queuedChannels,restoreChannelArtifact,saveChannelArtifact,sendChannelMessage } from "./collaboration-repository";
import { Join,MessageInput,AgentInput,ArtifactInput,TypingInput } from "./collaboration-input";
import { runAgent } from "./agent-worker";
import { HttpError,rateLimit } from "./http-security";
import type { Action } from "./permissions";
import { agentFailureDiagnostic } from "./job-errors";
type AuthSocket=Socket & {data:{roomId?:string;workspaceId?:string;memberId?:string;memberName?:string;userId?:string;sessionToken?:string}};
const memberSockets=new Map<string,Set<string>>();
function reply(ack:unknown,value:unknown){if(typeof ack==="function")ack(value);}
function sessionTokenFromCookie(header:string|undefined){for(const part of (header??"").split(";")){const [name,...value]=part.trim().split("=");if(name===sessionCookieName){try{return decodeURIComponent(value.join("="));}catch{return undefined;}}}return undefined;}
async function authorizedSession(socket:AuthSocket){try{const {userId,sessionToken}=socket.data;if(!userId||!sessionToken||(await findSession(sessionToken))?.userId!==userId){socket.disconnect(true);return false;}return true;}catch{socket.disconnect(true);return false;}}
async function authorized(socket:AuthSocket,action:Action="write"){
 if(!(await authorizedSession(socket)))return false;
 const {userId,workspaceId,roomId,memberId}=socket.data;if(!userId||!workspaceId||!roomId||!memberId)return false;
 try{const member=(await channelMember(userId,workspaceId,roomId,memberId,"read"));socket.data.memberName=member.name;}catch{socket.disconnect(true);return false;}
 try{(await channelMember(userId,workspaceId,roomId,memberId,action));if(action!=="read")(await touchUser(userId));return true;}catch{return false;}
}
function context(socket:AuthSocket){return {actor:socket.data.userId!,workspace:socket.data.workspaceId!,channel:socket.data.roomId!,member:socket.data.memberId!,name:socket.data.memberName!};}
function failure(ack:unknown,error:unknown){reply(ack,{error:error instanceof HttpError?error.message:"Could not complete this action.",...(error instanceof HttpError&&error.status===409?{conflict:true}:{})});}
export async function startQueuedWorkers(io:Server){for(const {roomId} of (await queuedChannels()))ensureWorker(io,roomId,runAgent);}
export function registerSocketHandlers(io:Server){
 io.use(async (socket,next)=>{try{rateLimit("socket:auth:"+socket.handshake.address,60);const token=sessionTokenFromCookie(socket.handshake.headers.cookie),session=token?(await findSession(token)):undefined;if(!session||!token){next(new Error("Authentication required."));return;}socket.data.userId=session.userId;socket.data.sessionToken=token;next();}catch{next(new Error("Authentication required."));}});
 io.on("connection",raw=>{
  const socket=raw as AuthSocket;trackWorkspaceSocket(socket);registerSessionSocket(socket.data.sessionToken!,socket);
  let checking=false,joining=false;
  const watch=setInterval(async ()=>{if(checking)return;checking=true;try{if(socket.data.roomId)(await authorized(socket,"read"));else (await authorizedSession(socket));}finally{checking=false;}},1000);watch.unref();socket.once("disconnect",()=>clearInterval(watch));
  socket.on("room:join",async (input:unknown,ack:unknown)=>{
   if(joining){reply(ack,{error:"A channel join is already in progress."});return;}joining=true;
   try{
   const parsed=Join.safeParse(input);if(!parsed.success||!(await authorizedSession(socket))){reply(ack,{error:"Not found."});return;}
   try{
    const {roomId,lastSeq}=parsed.data,actor=socket.data.userId!;rateLimit("channel:join:"+actor,60);const channel=(await channelForActor(actor,roomId));
    if(socket.data.roomId&&socket.data.roomId!==roomId){socket.disconnect(true);return;}
    const member=(await joinMember(actor,channel.workspaceId,roomId));
    if(!socket.connected)return;
    socket.data={...socket.data,roomId,workspaceId:channel.workspaceId,memberId:member.id,memberName:member.name};
    const key=roomId+":"+member.id,sockets=memberSockets.get(key)??new Set<string>();sockets.add(socket.id);memberSockets.set(key,sockets);
    const state=(await channelSnapshot(actor,channel.workspaceId,roomId,lastSeq));if(!socket.connected)return;await socket.join(roomId);state.members=state.members.map(m=>({...m,online:memberSockets.has(roomId+":"+m.id)}));
    reply(ack,{state,memberId:member.id,memberName:member.name,demoMode:(await publicAIConfig(actor,channel.workspaceId)).mode==="demo",ai:(await publicAIConfig(actor,channel.workspaceId))});io.to(roomId).emit("presence:update",{memberId:member.id,name:member.name,color:member.color,online:true});ensureWorker(io,roomId,runAgent);
   }catch(error){failure(ack,error);}
   }finally{joining=false;}
  });
  socket.on("message:send",async (input:unknown,ack:unknown)=>{
   if(!(await authorized(socket))){reply(ack,{error:"Not found."});return;}const parsed=MessageInput.safeParse(input);if(!parsed.success){reply(ack,{error:"Messages must be between 1 and 4,000 characters."});return;}
   try{const c=context(socket);rateLimit("message:"+c.actor,30);const result=(await sendChannelMessage(c.actor,c.workspace,c.channel,parsed.data));if(result.event)io.to(c.channel).emit("room:event",result.event);reply(ack,{ok:true,duplicate:result.duplicate,seq:result.seq});}catch(error){failure(ack,error);}
  });
  socket.on("agent:request",async (input:unknown,ack:unknown)=>{
   if(!(await authorized(socket,"agent"))){reply(ack,{error:"Not found."});return;}const parsed=AgentInput.safeParse(input);if(!parsed.success){reply(ack,{error:parsed.error.issues.some(issue=>issue.message==="Choose one agent mention per request.")?"Choose one agent mention per request.":"Agent prompts must be between 1 and 4,000 characters."});return;}
   try{const c=context(socket);rateLimit("agent:"+c.actor,6);const {result,messageEvent}=(await enqueueChannelAgent(c.actor,c.workspace,c.channel,parsed.data));if(result.event)io.to(c.channel).emit("room:event",result.event);if(messageEvent)io.to(c.channel).emit("room:event",messageEvent);io.to(c.channel).emit("queue:update",(await listQueueJobs(c.channel)));ensureWorker(io,c.channel,runAgent);reply(ack,{ok:true,jobId:result.job.id,duplicate:result.duplicate});}catch(error){console.warn(JSON.stringify({level:"warn",event:"agent_request_rejected",roomId:socket.data.roomId,...agentFailureDiagnostic(error),stage:"enqueue"}));failure(ack,error);}
  });
  socket.on("agent:cancel",async (input:unknown,ack:unknown)=>{
   if(!(await authorized(socket,"agent"))){reply(ack,{error:"Not found."});return;}const parsed=z.object({jobId:z.string().min(8).max(80)}).strict().safeParse(input);if(!parsed.success){reply(ack,{error:"Invalid job."});return;}
   try{const c=context(socket);(await cancelJob(c.channel,parsed.data.jobId,c.member,io));reply(ack,{ok:true});}catch(error){failure(ack,error);}
  });
  socket.on("typing:update",async (input:unknown)=>{if(!(await authorized(socket)))return;const parsed=TypingInput.safeParse(input);if(parsed.success){const c=context(socket);try{rateLimit("typing:"+c.actor,90);socket.to(c.channel).emit("typing:update",{memberId:c.member,name:c.name,active:parsed.data.active});}catch{}}});
  socket.on("artifact:save",async (input:unknown,ack:unknown)=>{
   if(!(await authorized(socket,"artifact"))){reply(ack,{error:"Not found."});return;}const parsed=ArtifactInput.safeParse(input);if(!parsed.success){reply(ack,{error:"Artifact is invalid or exceeds the 50,000 character limit."});return;}
   try{const c=context(socket);rateLimit("artifact:"+c.actor,20);io.to(c.channel).emit("room:event",(await saveChannelArtifact(c.actor,c.workspace,c.channel,parsed.data)));reply(ack,{ok:true});}catch(error){failure(ack,error);}
  });
  socket.on("artifact:restore",async (input:unknown,ack:unknown)=>{
   if(!(await authorized(socket,"artifact"))){reply(ack,{error:"Not found."});return;}const parsed=z.object({artifactId:z.string().min(8).max(80),version:z.number().int().positive()}).strict().safeParse(input);if(!parsed.success){reply(ack,{error:"Invalid artifact version."});return;}
   try{const c=context(socket);rateLimit("artifact:"+c.actor,20);io.to(c.channel).emit("room:event",(await restoreChannelArtifact(c.actor,c.workspace,c.channel,parsed.data.artifactId,parsed.data.version)));reply(ack,{ok:true});}catch(error){failure(ack,error);}
  });
  socket.on("disconnect",async ()=>{
   if(socket.data.sessionToken)unregisterSessionSocket(socket.data.sessionToken,socket);
   const {roomId,memberId}=socket.data;if(!roomId||!memberId)return;const key=roomId+":"+memberId,sockets=memberSockets.get(key);sockets?.delete(socket.id);if(!sockets?.size){memberSockets.delete(key);await markOffline(roomId,memberId).catch(()=>{});io.to(roomId).emit("presence:update",{memberId,online:false});}
  });
 });
}
