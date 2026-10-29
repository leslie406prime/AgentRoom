import type { ReactNode } from "react";
import Link from "next/link";
import Brand from "./Brand";
import Icon from "./Icon";

export default function SettingsShell({ children, title, description, section, workspaceId, navigation }: {
  children: ReactNode; title: string; description: string; section: "profile" | "workspace"; workspaceId?: string; navigation?: ReactNode;
}) {
  return <main className="min-h-screen bg-white md:grid md:grid-cols-[232px_minmax(0,1fr)]">
    <aside className="border-b border-line bg-panel md:sticky md:top-0 md:h-screen md:overflow-y-auto md:border-b-0 md:border-r">
      <div className="flex h-[72px] items-center border-b border-line px-5"><Brand /></div>
      <div className="px-5 pb-2 pt-7"><p className="eyebrow">Settings</p></div>
      <nav aria-label="Settings navigation" className="flex flex-wrap gap-1 p-3 md:flex-col">
        <Link href="/profile" aria-current={section === "profile" ? "page" : undefined} className={`flex items-center gap-2 rounded-md px-3 py-2.5 text-xs ${section === "profile" ? "bg-accent/[.08] font-medium text-accent" : "text-muted hover:bg-hover"}`}><Icon name="profile" />My profile</Link>
        {workspaceId && <Link href={"/workspaces/" + workspaceId} aria-current={section === "workspace" ? "page" : undefined} className={`flex items-center gap-2 rounded-md px-3 py-2.5 text-xs ${section === "workspace" ? "bg-accent/[.08] font-medium text-accent" : "text-muted hover:bg-hover"}`}><Icon name="settings" />Workspace settings</Link>}
        <Link href="/" className="flex items-center gap-2 rounded-md px-3 py-2.5 text-xs text-muted hover:bg-hover"><Icon name="arrow" className="h-4 w-4 rotate-180" />All workspaces</Link>
      </nav>
      {navigation && <><details className="border-t border-line md:hidden"><summary className="flex cursor-pointer list-none items-center justify-between px-6 py-3 text-xs text-muted">Workspace navigation<Icon name="chevron" className="h-3.5 w-3.5" /></summary>{navigation}</details><div className="hidden border-t border-line md:block">{navigation}</div></>}
      <div className="hidden px-5 py-8 text-[11px] leading-5 text-muted md:block">A little less friction.<br />A lot more working together.</div>
    </aside>
    <div className="min-w-0">
      <header className="flex h-14 items-center gap-2 border-b border-line px-6 text-xs text-muted md:h-[72px] md:px-10"><span>Settings</span><span className="text-neutral-300">/</span><span className="text-ink">{section === "profile" ? "My profile" : "Workspace"}</span></header>
      <div className="mx-auto max-w-[1040px] px-6 py-8 md:px-10 md:py-10">
        <div className="mb-9 border-b border-line pb-7"><p className="eyebrow mb-2">Make it yours</p><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm leading-6 text-muted">{description}</p></div>
        <div className="settings-content space-y-8">{children}</div>
      </div>
    </div>
  </main>;
}
