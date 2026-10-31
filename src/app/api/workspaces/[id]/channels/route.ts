import { apiActor } from "@/server/api-session";
import { apiError,readInput,rateLimit } from "@/server/http-security";
import { createChannel,NewChannel } from "@/server/channel-repository";
import { getWorkspace } from "@/server/workspace-repository";
type Context={params:Promise<{id:string}>};
export async function GET(_r:Request,{params}:Context){try{return Response.json((await getWorkspace(await apiActor(),(await params).id)).channels);}catch(e){return apiError(e);}}
export async function POST(request:Request,{params}:Context){try{const actor=await apiActor(request);rateLimit("channel:create:"+actor,20);return Response.json((await createChannel(actor,(await params).id,await readInput(request,NewChannel))),{status:201});}catch(e){return apiError(e);}}
