import ProfileForm from "./ProfileForm";
import { ownProfile, touchUser } from "@/server/profile-repository";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listIdentities } from "@/server/auth-repository";
import { mockOAuthEnabled } from "@/server/mock-oauth";
import Identities from "./Identities";
import SettingsShell from "@/components/SettingsShell";
import Icon from "@/components/Icon";
export default async function Profile() {
  const session=await auth(); if(!session?.user?.id) redirect("/sign-in?callbackUrl=/profile");
  touchUser(session.user.id);
  const profile=ownProfile(session.user.id);
  return <SettingsShell section="profile" title="My profile" description="A few details that help your team know who's behind the ideas.">
    <section className="settings-section"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-lg border border-line bg-panel text-muted"><Icon name="profile" className="h-5 w-5" /></span><div><h2>Personal details</h2><p className="mt-1 text-xs text-muted">{profile?.email} {profile?.emailVerified ? "(provider verified)" : "(verification unavailable)"}</p></div></div><ProfileForm name={profile?.name ?? ""}/></section>
    <Identities identities={listIdentities(session.user.id)} mock={mockOAuthEnabled()}/>
  </SettingsShell>;
}
