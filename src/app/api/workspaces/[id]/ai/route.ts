import { apiActor } from "@/server/api-session";
import { apiError } from "@/server/http-security";
import { publicAIConfig } from "@/server/ai-repository";
export async function GET(_r:Request,{params}:{params:Promise<{id:string}>}){try{return Response.json((await publicAIConfig(await apiActor(),(await params).id)));}catch(e){return apiError(e);}}
