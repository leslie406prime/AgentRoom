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
type AuthSocket=Socket & {data:{roomId?:string;workspaceId?:string;memberId?:string;memberName?:string;userId?:string;sessionToken?:string}};
const memberSockets=new Map<string,Set<string>>();
function reply(ack:unknown,value:unknown){if(typeof ack==="function")ack(value);}
function sessionTokenFromCookie(header:string|undefined){for(const part of (header??"").split(";")){const [name,...value]=part.trim().split("=");if(name===sessionCookieName){try{return decodeURIComponent(value.join("="));}catch{return undefined;}}}return undefined;}
function authorizedSession(socket:AuthSocket){const {userId,sessionToken}=socket.data;if(!userId||!sessionToken||findSession(sessionToken)?.userId!==userId){socket.disconnect(true);return false;}return true;}
function authorized(socket:AuthSocket,action:Action="write"){
 if(!authorizedSession(socket))return false;
 const {userId,workspaceId,roomId,memberId}=socket.data;if(!userId||!workspaceId||!roomId||!memberId)return false;
 try{const member=channelMember(userId,workspaceId,roomId,memberId,"read");socket.data.memberName=member.name;}catch{socket.disconnect(true);return false;}
 try{channelMember(userId,workspaceId,roomId,memberId,action);if(action!=="read")touchUser(userId);return true;}catch{return false;}
}
function context(socket:AuthSocket){return {actor:socket.data.userId!,workspace:socket.data.workspaceId!,channel:socket.data.roomId!,member:socket.data.memberId!,name:socket.data.memberName!};}
function failure(ack:unknown,error:unknown){reply(ack,{error:error instanceof HttpError?error.message:"Could not complete this action.",...(error instanceof HttpError&&error.status===409?{conflict:true}:{})});}
export function startQueuedWorkers(io:Server){for(const {roomId} of queuedChannels())ensureWorker(io,roomId,runAgent);}
export function registerSocketHandlers(io:Server){
 io.use((socket,next)=>{const token=sessionTokenFromCookie(socket.handshake.headers.cookie),session=token?findSession(token):undefined;if(!session||!token){next(new Error("Authentication required."));return;}socket.data.userId=session.userId;socket.data.sessionToken=token;next();});
 io.on("connection",raw=>{
  const socket=raw as AuthSocket;trackWorkspaceSocket(socket);registerSessionSocket(socket.data.sessionToken!,socket);
  const watch=setInterval(()=>{if(socket.data.roomId)authorized(socket,"read");else authorizedSession(socket);},1000);watch.unref();socket.once("disconnect",()=>clearInterval(watch));
  socket.on("room:join",(input:unknown,ack:unknown)=>{
   const parsed=Join.safeParse(input);if(!parsed.success||!authorizedSession(socket)){reply(ack,{error:"Not found."});return;}
   try{
    const {roomId,lastSeq}=parsed.data,actor=socket.data.userId!,channel=channelForActor(actor,roomId);
    if(socket.data.roomId&&socket.data.roomId!==roomId){socket.disconnect(true);return;}
    const member=joinMember(actor,channel.workspaceId,roomId);
    socket.data={...socket.data,roomId,workspaceId:channel.workspaceId,memberId:member.id,memberName:member.name};void socket.join(roomId);
    const key=roomId+":"+member.id,sockets=memberSockets.get(key)??new Set<string>();sockets.add(socket.id);memberSockets.set(key,sockets);
    const state=channelSnapshot(actor,channel.workspaceId,roomId,lastSeq);state.members=state.members.map(m=>({...m,online:memberSockets.has(roomId+":"+m.id)}));
    reply(ack,{state,memberId:member.id,memberName:member.name,demoMode:publicAIConfig(actor,channel.workspaceId).mode==="demo",ai:publicAIConfig(actor,channel.workspaceId)});io.to(roomId).emit("presence:update",{memberId:member.id,name:member.name,color:member.color,online:true});ensureWorker(io,roomId,runAgent);
   }catch(error){failure(ack,error);}
  });
  socket.on("message:send",(input:unknown,ack:unknown)=>{
   if(!authorized(socket)){reply(ack,{error:"Not found."});return;}const parsed=MessageInput.safeParse(input);if(!parsed.success){reply(ack,{error:"Messages must be between 1 and 4,000 characters."});return;}
   try{const c=context(socket);rateLimit("message:"+c.actor,30);const result=sendChannelMessage(c.actor,c.workspace,c.channel,parsed.data);if(result.event)io.to(c.channel).emit("room:event",result.event);reply(ack,{ok:true,duplicate:result.duplicate,seq:result.seq});}catch(error){failure(ack,error);}
  });
  socket.on("agent:request",(input:unknown,ack:unknown)=>{
   if(!authorized(socket,"agent")){reply(ack,{error:"Not found."});return;}const parsed=AgentInput.safeParse(input);if(!parsed.success){reply(ack,{error:"Agent prompts must be between 1 and 4,000 characters."});return;}
   try{const c=context(socket);rateLimit("agent:"+c.actor,6);const {result,messageEvent}=enqueueChannelAgent(c.actor,c.workspace,c.channel,parsed.data);if(result.event)io.to(c.channel).emit("room:event",result.event);if(messageEvent)io.to(c.channel).emit("room:event",messageEvent);io.to(c.channel).emit("queue:update",listQueueJobs(c.channel));ensureWorker(io,c.channel,runAgent);reply(ack,{ok:true,jobId:result.job.id,duplicate:result.duplicate});}catch(error){failure(ack,error);}
  });
  socket.on("agent:cancel",(input:unknown,ack:unknown)=>{
   if(!authorized(socket,"agent")){reply(ack,{error:"Not found."});return;}const parsed=z.object({jobId:z.string().min(8).max(80)}).strict().safeParse(input);if(!parsed.success){reply(ack,{error:"Invalid job."});return;}
   try{const c=context(socket);cancelJob(c.channel,parsed.data.jobId,c.member,io);reply(ack,{ok:true});}catch(error){failure(ack,error);}
  });
  socket.on("typing:update",(input:unknown)=>{if(!authorized(socket))return;const parsed=TypingInput.safeParse(input);if(parsed.success){const c=context(socket);try{rateLimit("typing:"+c.actor,90);socket.to(c.channel).emit("typing:update",{memberId:c.member,name:c.name,active:parsed.data.active});}catch{}}});
  socket.on("artifact:save",(input:unknown,ack:unknown)=>{
   if(!authorized(socket,"artifact")){reply(ack,{error:"Not found."});return;}const parsed=ArtifactInput.safeParse(input);if(!parsed.success){reply(ack,{error:"Artifact is invalid or exceeds the 50,000 character limit."});return;}
   try{const c=context(socket);rateLimit("artifact:"+c.actor,20);io.to(c.channel).emit("room:event",saveChannelArtifact(c.actor,c.workspace,c.channel,parsed.data));reply(ack,{ok:true});}catch(error){failure(ack,error);}
  });
  socket.on("artifact:restore",(input:unknown,ack:unknown)=>{
   if(!authorized(socket,"artifact")){reply(ack,{error:"Not found."});return;}const parsed=z.object({artifactId:z.string().min(8).max(80),version:z.number().int().positive()}).strict().safeParse(input);if(!parsed.success){reply(ack,{error:"Invalid artifact version."});return;}
   try{const c=context(socket);rateLimit("artifact:"+c.actor,20);io.to(c.channel).emit("room:event",restoreChannelArtifact(c.actor,c.workspace,c.channel,parsed.data.artifactId,parsed.data.version));reply(ack,{ok:true});}catch(error){failure(ack,error);}
  });
  socket.on("disconnect",()=>{
   if(socket.data.sessionToken)unregisterSessionSocket(socket.data.sessionToken,socket);
   const {roomId,memberId}=socket.data;if(!roomId||!memberId)return;const key=roomId+":"+memberId,sockets=memberSockets.get(key);sockets?.delete(socket.id);if(!sockets?.size){memberSockets.delete(key);markOffline(roomId,memberId);io.to(roomId).emit("presence:update",{memberId,online:false});}
  });
 });
}
