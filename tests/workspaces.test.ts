import { randomUUID } from "node:crypto";
import { describe,expect,it } from "vitest";
import { db } from "../src/server/db";
import { acceptInvitation,changeMember,channelScope,claimLegacy,createInvitation,createWorkspace,deleteWorkspace,getWorkspace,listInvitations,listWorkspaces,requireRole,revokeInvitation,transferOwnership } from "../src/server/workspace-repository";
import { can } from "../src/server/permissions";
import { listHomeWorkspaces } from "../src/server/workspace-repository";
import { channelSnapshot } from "../src/server/collaboration-repository";
async function user(){const id=randomUUID();(await db.prepare('INSERT INTO "user"(id,name,email,created_at) VALUES (?,?,?,?)').run(id,id,id+"@example.test",Date.now()));return id;}
async function fixture(){const owner=(await user()),other=(await user());const workspace=(await createWorkspace(owner,{name:"Test workspace"}));return {owner,other,...workspace};}
async function join(owner:string,id:string,other:string,role="MEMBER"){const invite=(await createInvitation(owner,id,{role}));return (await acceptInvitation(other,invite.path.split("/").at(-1)!));}
it("lists only the homepage user's memberships with their general-channel destinations", async () => {
 const actor=(await user()),foreign=(await user()),one=(await createWorkspace(actor,{name:"First workspace"})),two=(await createWorkspace(actor,{name:"Second workspace"}));
 const privateWorkspace=(await createWorkspace(foreign,{name:"Private workspace"}));
 expect((await listHomeWorkspaces(actor))).toEqual(expect.arrayContaining([
  {id:one.id,name:"First workspace",channelId:one.channelId},
  {id:two.id,name:"Second workspace",channelId:two.channelId},
 ]));
 expect((await listHomeWorkspaces(actor))).toHaveLength(2);
 expect((await listHomeWorkspaces(actor)).some(w=>w.id===privateWorkspace.id)).toBe(false);
});
it("claims only the supplied legacy capability and preserves historical rows and ordering", async () => {
 const actor=(await user()),outsider=(await user()),legacy=randomUUID(),room=randomUUID(),member=randomUUID(),job=randomUUID(),artifact=randomUUID();
 (await db.prepare("INSERT INTO workspaces(id,name,unclaimed_legacy,created_at) VALUES (?,'Historical fixture',1,?)").run(legacy,Date.now()));
 (await db.prepare("INSERT INTO rooms(id,name,created_at,next_seq) VALUES (?,'Historical fixture','2024-01-01',9)").run(room));
 (await db.prepare("INSERT INTO channels(id,workspace_id,name,is_general) VALUES (?,?,'general',1)").run(room,legacy));
 (await db.prepare("INSERT INTO legacy_room_links(old_room_id,channel_id) VALUES (?,?)").run(room,room));
 (await db.prepare("INSERT INTO members(id,room_id,name,color,created_at,last_seen) VALUES (?,?,'Original member','#555555','2024-01-01','2024-01-01')").run(member,room));
 (await db.prepare("INSERT INTO agent_jobs(id,room_id,requester_id,requester_name,prompt,idempotency_key,status,created_at,updated_at) VALUES (?,?,?,'Original member','Fixture prompt',?,'completed','2024-01-01','2024-01-02')").run(job,room,member,randomUUID()));
 (await db.prepare("INSERT INTO messages(id,room_id,author_id,author_name,content,kind,created_at,seq) VALUES (?,?,?,'Original member','Original human fixture','human','2024-01-01',3)").run(randomUUID(),room,member));
 (await db.prepare("INSERT INTO messages(id,room_id,author_id,author_name,content,kind,created_at,seq,job_id) VALUES (?,?,'agent','Room agent','Original AI fixture','agent','2024-01-02',7,?)").run(randomUUID(),room,job));
 (await db.prepare("INSERT INTO room_events(room_id,seq,type,payload,created_at) VALUES (?,9,'artifact','{}','2024-01-02')").run(room));
 (await db.prepare("INSERT INTO artifacts(id,room_id,title,type,language,content,version,updated_by,updated_at) VALUES (?,?,'Original notes','document','markdown','Original artifact fixture',2,'Original member','2024-01-02')").run(artifact,room));
 (await db.prepare("INSERT INTO artifact_versions(room_id,artifact_id,version,title,type,language,content,updated_by,updated_at) VALUES (?,?,1,'Original notes','document','markdown','Earlier fixture','Original member','2024-01-01')").run(room,artifact));
 const history=async ()=>Object.fromEntries((await Promise.all(["rooms","members","room_events","messages","agent_jobs","artifacts","artifact_versions"].map(async table=>[table,(await db.prepare('SELECT * FROM '+table+' WHERE '+(table==="rooms"?"id":"room_id")+'=? ORDER BY rowid').all(room))]))));
 const before=(await history());
 expect((await listHomeWorkspaces(actor)).some(w=>w.id===legacy)).toBe(false);
 (await expect((async () => (await channelSnapshot(actor,legacy,room)))()).rejects.toThrow("Not found"));
 expect((await claimLegacy(actor,room))).toMatchObject({id:room,workspaceId:legacy});
 expect((await claimLegacy(actor,room))).toMatchObject({id:room});
 const snapshot=(await channelSnapshot(actor,legacy,room));
 expect(snapshot.messages).toMatchObject([{content:"Original human fixture",seq:3},{content:"Original AI fixture",seq:7}]);
 expect(snapshot.artifacts).toMatchObject([{content:"Original artifact fixture",version:2}]);
 expect(snapshot.versions).toMatchObject([{content:"Earlier fixture",version:1}]);
 expect((await history())).toEqual(before);
 expect((await listHomeWorkspaces(actor))).toContainEqual({id:legacy,name:"Historical fixture",channelId:room});
 (await expect((async () => (await claimLegacy(outsider,room)))()).rejects.toThrow("Not found"));
 (await expect((async () => (await channelSnapshot(outsider,legacy,room)))()).rejects.toThrow("Not found"));
 expect((await db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE workspace_id=?").get(legacy))).toEqual({n:1});
});
describe("workspace boundaries",()=>{
 it("creates OWNER membership and general atomically, hides unrelated workspaces",async ()=>{
  const a=(await fixture());expect((await requireRole(a.owner,a.id))).toBe("OWNER");expect((await getWorkspace(a.owner,a.id)).channels).toMatchObject([{name:"general",isGeneral:1}]);
  expect((await listWorkspaces(a.other))).toEqual([]);(await expect((async () => (await getWorkspace(a.other,a.id)))()).rejects.toThrow("Not found"));(await expect((async () => (await channelScope(a.other,a.id,a.channelId)))()).rejects.toThrow("Not found"));
  const before=((await db.prepare("SELECT COUNT(*) AS n FROM workspaces").get()) as {n:number}).n;
  (await expect((async () => (await createWorkspace("missing-user",{name:"Rollback"})))()).rejects.toThrow());expect(((await db.prepare("SELECT COUNT(*) AS n FROM workspaces").get()) as {n:number}).n).toBe(before);
 });
 it("scopes channel access by both workspace and membership",async ()=>{
  const a=(await fixture()),b=(await fixture());(await expect((async () => (await channelScope(a.owner,a.id,b.channelId)))()).rejects.toThrow());(await expect((async () => (await channelScope(a.owner,b.id,b.channelId,"write")))()).rejects.toThrow());
 });
 it("keeps other members' email addresses out of member responses",async ()=>{
  const a=(await fixture());(await join(a.owner,a.id,a.other));const view=(await getWorkspace(a.other,a.id));
  expect(view.members.find(m=>m.id===a.owner)).not.toHaveProperty("email");expect(view.members.find(m=>m.id===a.other)).toHaveProperty("email");expect((await getWorkspace(a.owner,a.id)).members.every(m=>"email" in m)).toBe(true);
 });
 it("enforces owner/admin/member boundaries centrally",async ()=>{
  for(const action of ["settings","member:role","workspace:delete","channel:manage","invite"] as const)expect(can("MEMBER",action)).toBe(false);
  expect(can("ADMIN","member:remove",{targetRole:"MEMBER"})).toBe(true);for(const role of ["OWNER","ADMIN"] as const)expect(can("ADMIN","member:remove",{targetRole:role})).toBe(false);
  expect(can("ADMIN","invite",{inviteRole:"OWNER"})).toBe(false);
  const a=(await fixture());(await join(a.owner,a.id,a.other,"ADMIN"));(await expect((async () => (await changeMember(a.other,a.id,a.owner)))()).rejects.toThrow());(await expect((async () => (await changeMember(a.other,a.id,a.owner,"MEMBER")))()).rejects.toThrow());(await expect((async () => (await requireRole(a.other,a.id,"settings")))()).rejects.toThrow());const anotherAdmin=(await user());(await join(a.owner,a.id,anotherAdmin,"ADMIN"));(await expect((async () => (await changeMember(a.other,a.id,anotherAdmin)))()).rejects.toThrow());(await expect((async () => (await changeMember(a.other,a.id,anotherAdmin,"MEMBER")))()).rejects.toThrow());
 });
 it("protects the last owner and transfers ownership transactionally",async ()=>{
  const a=(await fixture());(await join(a.owner,a.id,a.other));(await expect((async () => (await changeMember(a.owner,a.id,a.owner)))()).rejects.toThrow("last owner"));(await expect((async () => (await changeMember(a.owner,a.id,a.owner,"ADMIN")))()).rejects.toThrow("last owner"));
  (await transferOwnership(a.owner,a.id,a.other));expect((await requireRole(a.other,a.id))).toBe("OWNER");expect((await requireRole(a.owner,a.id))).toBe("MEMBER");(await changeMember(a.owner,a.id,a.owner));(await expect((async () => (await requireRole(a.owner,a.id)))()).rejects.toThrow());
 });
 it("requires exact typed deletion and cascades all workspace content",async ()=>{
  const a=(await fixture());(await expect((async () => (await deleteWorkspace(a.owner,a.id,"wrong")))()).rejects.toThrow());(await deleteWorkspace(a.owner,a.id,"Test workspace"));(await expect((async () => (await getWorkspace(a.owner,a.id)))()).rejects.toThrow());expect((await db.prepare("SELECT 1 FROM rooms WHERE id=?").get(a.channelId))).toBeUndefined();
 });
 it("claims a legacy workspace exactly once without exposing it in listings",async ()=>{
  const a=(await fixture()),legacy=randomUUID(),channel=randomUUID();(await db.prepare("INSERT INTO workspaces(id,name,unclaimed_legacy,created_at) VALUES (?,'Legacy',1,?)").run(legacy,Date.now()));(await db.prepare("INSERT INTO rooms(id,name) VALUES (?,'Legacy')").run(channel));(await db.prepare("INSERT INTO channels(id,workspace_id,name,is_general) VALUES (?,?,'general',1)").run(channel,legacy));(await db.prepare("INSERT INTO legacy_room_links(old_room_id,channel_id) VALUES (?,?)").run(channel,channel));
  expect((await listWorkspaces(a.owner)).some(w=>w.id===legacy)).toBe(false);expect((await claimLegacy(a.owner,channel)).workspaceId).toBe(legacy);expect((await requireRole(a.owner,legacy))).toBe("OWNER");(await expect((async () => (await claimLegacy(a.other,channel)))()).rejects.toThrow());
 });
});
describe("invitations",()=>{
 it("stores a hash, enforces single use and accepts existing members idempotently",async ()=>{
  const a=(await fixture()),third=(await user());const invite=(await createInvitation(a.owner,a.id,{})),token=invite.path.split("/").at(-1)!;
  expect(JSON.stringify((await listInvitations(a.owner,a.id)))).not.toContain(token);expect(((await db.prepare("SELECT token_hash FROM invitations WHERE id=?").get(invite.id)) as {token_hash:string}).token_hash).not.toBe(token);
  (await acceptInvitation(a.other,token));(await expect((async () => (await acceptInvitation(third,token)))()).rejects.toThrow("unavailable"));expect((await acceptInvitation(a.other,token)).workspaceId).toBe(a.id);expect(((await db.prepare("SELECT uses FROM invitations WHERE id=?").get(invite.id)) as {uses:number}).uses).toBe(1);
 });
 it("rejects expired and revoked invitations without disclosing workspace details",async ()=>{
  const a=(await fixture());for(const kind of ["expired","revoked"]){const invite=(await createInvitation(a.owner,a.id,{}));if(kind==="expired")(await db.prepare("UPDATE invitations SET expires_at=0 WHERE id=?").run(invite.id));else (await revokeInvitation(a.owner,a.id,invite.id));(await expect((async () => (await acceptInvitation(a.other,invite.path.split("/").at(-1)!)))()).rejects.toThrow("This invitation is unavailable."));}
 });
 it("permits ADMIN invitations only with MEMBER role",async ()=>{
  const a=(await fixture());(await join(a.owner,a.id,a.other,"ADMIN"));(await expect((async () => (await createInvitation(a.other,a.id,{role:"ADMIN"})))()).rejects.toThrow());(await expect((async () => (await createInvitation(a.other,a.id,{role:"OWNER"})))()).rejects.toThrow());expect((await createInvitation(a.other,a.id,{})).path).toMatch(/^\/invite\//);
 });
});

it("binds optional invitation email to a provider-verified authenticated account",async ()=>{
 const owner=(await user()),person=(await user()),w=(await createWorkspace(owner,{name:"Bound email"}));const email=((await db.prepare('SELECT email FROM "user" WHERE id=?').get(person)) as {email:string}).email;
 const invite=(await createInvitation(owner,w.id,{email}));const token=invite.path.split("/").at(-1)!;(await expect((async () => (await acceptInvitation(person,token)))()).rejects.toThrow("unavailable"));(await db.prepare('UPDATE "user" SET emailVerified=? WHERE id=?').run(Date.now(),person));expect((await acceptInvitation(person,token)).workspaceId).toBe(w.id);
});
