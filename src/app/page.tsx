import { auth } from "@/auth";
import HomeClient from "@/components/HomeClient";
import { listHomeWorkspaces } from "@/server/workspace-repository";

// Read the same cookie-backed session as workspace routes on every request.
export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  const user = session?.user?.id ? {
    name: session.user.name?.trim() || "AgentRoom member",
    image: session.user.image,
  } : null;
  const workspaces = session?.user?.id ? (await listHomeWorkspaces(session.user.id)) : [];
  return <HomeClient user={user} workspaces={workspaces} />;
}
