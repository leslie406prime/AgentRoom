import { auth } from "@/auth";
import { createWorkspace, WorkspaceInput } from "@/server/workspace-repository";
import { apiError, assertOrigin, HttpError, rateLimit, readInput } from "@/server/http-security";
export async function POST(request:Request) {
  try {
    assertOrigin(request);const session=await auth();
    if(!session?.user?.id) throw new HttpError(401,"Authentication required.");
    rateLimit("workspace:create:"+session.user.id,5);
    const workspace=createWorkspace(session.user.id,await readInput(request,WorkspaceInput));
    return Response.json({id:workspace.channelId,workspaceId:workspace.id},{status:201});
  } catch(error) { return apiError(error); }
}
