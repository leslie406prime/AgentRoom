import { apiActor } from "@/server/api-session";
import { apiError, rateLimit } from "@/server/http-security";
import { requireRole } from "@/server/workspace-repository";
import { verifyProvider } from "@/server/ai-providers";
import { catalog, modelKey } from "@/lib/ai-catalog";
import { publicAIConfig } from "@/server/ai-workspace";
import { notifyWorkspaceAI } from "@/server/workspace-sockets";
type Context = { params: Promise<{ id: string }> };
// Owner-only live check: asks each configured provider which models the server's key can reach. Never returns keys.
export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await apiActor(request), { id } = await params;
    (await requireRole(actor, id, "settings")); rateLimit("ai-verify:" + actor, 5);
    const providers = [];
    for (const provider of ["gemini", "groq"] as const) {
      const result = await verifyProvider(provider, true);
      providers.push({ provider, ...(result.ok ? { ok: true, models: catalog.filter((m) => m.provider === provider).map((m) => ({ key: modelKey(m.provider, m.id), accessible: result.ids.includes(m.id) })) } : { ok: false, message: result.message }) });
    }
    notifyWorkspaceAI(id, (await publicAIConfig(actor, id)));
    return Response.json({ providers }, { headers: { "cache-control": "private, no-store" } });
  } catch (e) { return apiError(e); }
}
