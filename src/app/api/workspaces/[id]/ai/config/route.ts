import { apiActor } from "@/server/api-session";
import { apiError, readInput } from "@/server/http-security";
import { AIConfigInput, getAIConfig, updateAIConfig, publicAIConfig } from "@/server/ai-workspace";
import { notifyWorkspaceAI } from "@/server/workspace-sockets";
type Context = { params: Promise<{ id: string }> };
const headers = { "cache-control": "private, no-store" };
export async function GET(_r: Request, { params }: Context) { try { return Response.json((await getAIConfig(await apiActor(), (await params).id)), { headers }); } catch (e) { return apiError(e); } }
export async function PUT(request: Request, { params }: Context) {
  try {
    const actor = await apiActor(request), { id } = await params;
    const config = (await updateAIConfig(actor, id, await readInput(request, AIConfigInput)));
    notifyWorkspaceAI(id, (await publicAIConfig(actor, id)));
    return Response.json(config, { headers });
  } catch (e) { return apiError(e); }
}
