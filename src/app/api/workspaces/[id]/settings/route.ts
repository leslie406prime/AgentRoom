import { apiActor } from "@/server/api-session";
import { apiError,readInput } from "@/server/http-security";
import { AISettingsInput,getAISettings,publicAIConfig,updateAISettings } from "@/server/ai-repository";
import { notifyWorkspaceAI } from "@/server/workspace-sockets";
type Context={params:Promise<{id:string}>};
export async function GET(_r:Request,{params}:Context){try{return Response.json((await getAISettings(await apiActor(),(await params).id)),{headers:{"cache-control":"private, no-store"}});}catch(e){return apiError(e);}}
export async function PUT(request:Request,{params}:Context){try{const actor=await apiActor(request),{id}=await params;const settings=(await updateAISettings(actor,id,await readInput(request,AISettingsInput)));notifyWorkspaceAI(id,(await publicAIConfig(actor,id)));return Response.json(settings,{headers:{"cache-control":"private, no-store"}});}catch(e){return apiError(e);}}
