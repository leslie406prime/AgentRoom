import { apiActor } from "@/server/api-session";
import { apiError,rateLimit } from "@/server/http-security";
import { acceptInvitation } from "@/server/workspace-repository";
export async function POST(request:Request,{params}:{params:Promise<{token:string}>}) {try{const actor=await apiActor(request);rateLimit("invite:accept:"+actor,10);return Response.json(acceptInvitation(actor,(await params).token));}catch(e){return apiError(e);}}
