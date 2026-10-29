import { apiActor } from "@/server/api-session";
import { apiError,readInput } from "@/server/http-security";
import { changeMember,transferOwnership } from "@/server/workspace-repository";
import { z } from "zod";
const Input=z.object({userId:z.string().min(1).max(100),role:z.enum(["OWNER","ADMIN","MEMBER"]).optional(),transfer:z.boolean().default(false)}).strict();
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 try {const actor=await apiActor(request),input=await readInput(request,Input),{id}=await params;if(input.transfer) transferOwnership(actor,id,input.userId);else changeMember(actor,id,input.userId,input.role);return Response.json({ok:true});}catch(e){return apiError(e);}
}
