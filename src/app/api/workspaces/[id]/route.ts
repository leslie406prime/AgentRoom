import { apiActor } from "@/server/api-session";
import { apiError,readInput } from "@/server/http-security";
import { changeWorkspace,deleteWorkspace,getWorkspace,WorkspaceInput } from "@/server/workspace-repository";
import { z } from "zod";
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,{params}:Context) {try{return Response.json(getWorkspace(await apiActor(),(await params).id));}catch(e){return apiError(e);}}
export async function PATCH(request:Request,{params}:Context) {try{const actor=await apiActor(request);await changeWorkspace(actor,(await params).id,await readInput(request,z.object({name:WorkspaceInput.shape.name,avatar:z.string().max(80)}).strict()));return Response.json({ok:true});}catch(e){return apiError(e);}}
export async function DELETE(request:Request,{params}:Context) {try{const actor=await apiActor(request);const input=await readInput(request,z.object({confirmation:z.string().max(60)}).strict());await deleteWorkspace(actor,(await params).id,input.confirmation);return Response.json({ok:true});}catch(e){return apiError(e);}}
