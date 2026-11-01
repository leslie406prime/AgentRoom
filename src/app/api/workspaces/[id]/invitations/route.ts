import { apiActor } from "@/server/api-session";
import { apiError,readInput,rateLimit } from "@/server/http-security";
import { createInvitation,listInvitations,revokeInvitation,InvitationInput } from "@/server/workspace-repository";
import { z } from "zod";
type Context={params:Promise<{id:string}>};
export async function GET(_r:Request,{params}:Context) {try{return Response.json((await listInvitations(await apiActor(),(await params).id)));}catch(e){return apiError(e);}}
export async function POST(request:Request,{params}:Context) {try{const actor=await apiActor(request);rateLimit("invite:create:"+actor,15);return Response.json((await createInvitation(actor,(await params).id,await readInput(request,InvitationInput))),{status:201});}catch(e){return apiError(e);}}
export async function DELETE(request:Request,{params}:Context) {try{const actor=await apiActor(request),input=await readInput(request,z.object({id:z.string().max(100)}).strict());(await revokeInvitation(actor,(await params).id,input.id));return Response.json({ok:true});}catch(e){return apiError(e);}}
