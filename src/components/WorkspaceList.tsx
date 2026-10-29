import Link from "next/link";
import type { HomeWorkspace } from "@/server/workspace-repository";

export default function WorkspaceList({ workspaces }: { workspaces: HomeWorkspace[] }) {
  return <nav aria-label="Your workspaces" className="flex flex-wrap items-center gap-2">{workspaces.map(workspace =>
    <Link key={workspace.id} href={"/workspaces/" + workspace.id + "/channels/" + workspace.channelId} className="btn">{workspace.name}</Link>
  )}</nav>;
}
