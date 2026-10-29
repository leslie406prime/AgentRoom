import { invitationAvailable } from "@/server/workspace-repository";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AcceptInvitation from "./AcceptInvitation";
import Brand from "@/components/Brand";
export default async function Invite({params}:{params:Promise<{token:string}>}) {
 const {token}=await params;const session=await auth();if(!session?.user?.id)redirect("/sign-in?callbackUrl="+encodeURIComponent("/invite/"+token));
 if(!invitationAvailable(session.user.id,token))return <main className="mx-auto max-w-md px-6 py-14"><Brand /><h1 className="mt-12 text-2xl font-semibold tracking-tight">This invitation is unavailable</h1><p className="mt-3 text-sm text-muted">Ask the inviter for a new link.</p></main>;
 return <main className="mx-auto max-w-md px-6 py-14"><Brand /><h1 className="mt-12 text-2xl font-semibold tracking-tight">Workspace invitation</h1><AcceptInvitation token={token}/></main>;
}
