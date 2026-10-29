import { auth } from "@/auth";
import { ownProfile, ProfileInput, touchUser, updateProfile } from "@/server/profile-repository";
import { apiError, assertOrigin, HttpError, readInput } from "@/server/http-security";
export async function GET() {
  const session=await auth();
  if(!session?.user?.id) return Response.json({error:"Authentication required."},{status:401});
  touchUser(session.user.id);
  return Response.json(ownProfile(session.user.id));
}
export async function PATCH(request: Request) {
  try {
    assertOrigin(request); const session=await auth();
    if(!session?.user?.id) throw new HttpError(401,"Authentication required.");
    return Response.json(updateProfile(session.user.id,await readInput(request,ProfileInput)));
  } catch(error) { return apiError(error); }
}
