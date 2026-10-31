import { auth } from "@/auth";
import { cookies } from "next/headers";
import { z } from "zod";
import { beginLink, sessionCookieName, unlinkIdentity } from "@/server/auth-repository";
import { apiError, assertOrigin, HttpError, rateLimit, readInput } from "@/server/http-security";
const Input = z.object({ provider: z.enum(["google", "mock-google"]), account: z.string().min(1).max(300).optional() });
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const session = await auth();
    if (!session?.user?.id) throw new HttpError(401, "Authentication required.");
    rateLimit("link:" + session.user.id, 10);
    const { provider } = await readInput(request, Input);
    const jar = await cookies();
    const token = jar.get(sessionCookieName)?.value;
    if (!token) throw new HttpError(401, "Authentication required.");
    jar.set("agentroom.link-intent", (await beginLink(token, provider)), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 300 });
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request) {
  try {
    assertOrigin(request);
    const session = await auth();
    if (!session?.user?.id) throw new HttpError(401, "Authentication required.");
    const { provider, account } = await readInput(request, Input);
    if (!account) throw new HttpError(400, "Identity required.");
    (await unlinkIdentity(session.user.id, provider, account));
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
