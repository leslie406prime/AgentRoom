import { getAISettings } from "@/server/ai-repository";
import { getAIConfig } from "@/server/ai-workspace";
import { auth } from "@/auth";
import { getWorkspace,listInvitations,listWorkspaces } from "@/server/workspace-repository";
import { can } from "@/server/permissions";
import { notFound,redirect } from "next/navigation";
import WorkspaceSettings from "./WorkspaceSettings";
export default async function WorkspacePage({params}:{params:Promise<{id:string}>}) {
 const {id}=await params;const session=await auth();if(!session?.user?.id)redirect("/sign-in?callbackUrl="+encodeURIComponent("/workspaces/"+id));
 let workspace;try{workspace=(await getWorkspace(session.user.id,id));}catch{notFound();}
 return <WorkspaceSettings workspace={workspace} workspaces={(await listWorkspaces(session.user.id))} actor={session.user.id} aiSettings={can(workspace.role,"settings")?(await getAISettings(session.user.id,id)):undefined} aiConfig={can(workspace.role,"settings")?(await getAIConfig(session.user.id,id)):undefined} invitations={can(workspace.role,"invite")?(await listInvitations(session.user.id,id)):[]}/>;
}
