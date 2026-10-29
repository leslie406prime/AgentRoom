import { auth } from "@/auth";
import { createWorkspace, listWorkspaces, WorkspaceInput } from "@/server/workspace-repository";
import { apiError, assertOrigin, HttpError, rateLimit, readInput } from "@/server/http-security";
export async function GET() { const session=await auth(); if(!session?.user?.id) return Response.json({error:"Authentication required."},{status:401}); return Response.json(listWorkspaces(session.user.id)); }
export async function POST(request:Request) {
  try {assertOrigin(request);const session=await auth();if(!session?.user?.id) throw new HttpError(401,"Authentication required.");rateLimit("workspace:create:"+session.user.id,5);return Response.json(createWorkspace(session.user.id,await readInput(request,WorkspaceInput)),{status:201});}catch(error){return apiError(error);}
}
