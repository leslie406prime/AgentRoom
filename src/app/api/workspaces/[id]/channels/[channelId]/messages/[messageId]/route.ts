import { apiActor } from "@/server/api-session";
import { apiError } from "@/server/http-security";
import { deleteChannelMessage } from "@/server/collaboration-repository";
import { emitChannel } from "@/server/workspace-sockets";
export async function DELETE(request:Request,{params}:{params:Promise<{id:string;channelId:string;messageId:string}>}){try{const actor=await apiActor(request),{id,channelId,messageId}=await params;emitChannel(channelId,"room:event",(await deleteChannelMessage(actor,id,channelId,messageId)));return Response.json({ok:true});}catch(e){return apiError(e);}}
