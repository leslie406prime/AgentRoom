import { apiActor } from "@/server/api-session";
import { apiError,readInput } from "@/server/http-security";
import { deleteChannel,EditChannel,updateChannel } from "@/server/channel-repository";
import { channelSnapshot } from "@/server/collaboration-repository";
import { z } from "zod";
type Context={params:Promise<{id:string;channelId:string}>};
export async function GET(request:Request,{params}:Context){try{const actor=await apiActor(),{id,channelId}=await params;const seq=z.coerce.number().int().nonnegative().parse(new URL(request.url).searchParams.get("after")??0);return Response.json(channelSnapshot(actor,id,channelId,seq));}catch(e){return apiError(e);}}
export async function PATCH(request:Request,{params}:Context){try{const actor=await apiActor(request),{id,channelId}=await params;updateChannel(actor,id,channelId,await readInput(request,EditChannel));return Response.json({ok:true});}catch(e){return apiError(e);}}
export async function DELETE(request:Request,{params}:Context){try{const actor=await apiActor(request),{id,channelId}=await params;deleteChannel(actor,id,channelId);return Response.json({ok:true});}catch(e){return apiError(e);}}
