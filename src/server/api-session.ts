import { auth } from "@/auth";
import { assertOrigin, HttpError } from "./http-security";
export async function apiActor(request?:Request) {
  if(request) assertOrigin(request);
  const session=await auth();if(!session?.user?.id) throw new HttpError(401,"Authentication required.");
  return session.user.id;
}
