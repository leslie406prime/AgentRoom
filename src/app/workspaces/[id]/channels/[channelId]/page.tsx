import { auth } from "@/auth";
import { channelScope,getWorkspace,listWorkspaces } from "@/server/workspace-repository";
import { notFound,redirect } from "next/navigation";
import RoomClient from "@/components/RoomClient";
export default async function ChannelPage({params}:{params:Promise<{id:string;channelId:string}>}) {
 const {id,channelId}=await params;const session=await auth();if(!session?.user?.id)redirect("/sign-in?callbackUrl="+encodeURIComponent("/workspaces/"+id+"/channels/"+channelId));
 let channel,workspace;try{channel=channelScope(session.user.id,id,channelId);workspace=getWorkspace(session.user.id,id);}catch{notFound();}
 return <RoomClient room={{id:channel.id,name:channel.name}} user={{id:session.user.id,name:session.user.name??"Member",image:session.user.image}} workspace={{id:workspace.id,name:workspace.name,role:workspace.role,avatar:workspace.avatar,channels:workspace.channels}} workspaces={listWorkspaces(session.user.id)}/>;
}
