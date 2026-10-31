import { auth } from "@/auth";
import { claimLegacy } from "@/server/workspace-repository";
import { notFound, redirect } from "next/navigation";
export const runtime="nodejs";
export default async function LegacyRoom({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;const session=await auth();
  if(!session?.user?.id) redirect("/sign-in?callbackUrl="+encodeURIComponent("/room/"+id));
  let channel;try {channel=(await claimLegacy(session.user.id,id));} catch {notFound();}
  redirect("/workspaces/"+channel.workspaceId+"/channels/"+channel.id);
}
