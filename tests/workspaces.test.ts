import { randomUUID } from "node:crypto";
import { describe,expect,it } from "vitest";
import { db } from "../src/server/db";
import { acceptInvitation,changeMember,channelScope,claimLegacy,createInvitation,createWorkspace,deleteWorkspace,getWorkspace,listInvitations,listWorkspaces,requireRole,revokeInvitation,transferOwnership } from "../src/server/workspace-repository";
import { can } from "../src/server/permissions";
import { listHomeWorkspaces } from "../src/server/workspace-repository";
import { channelSnapshot } from "../src/server/collaboration-repository";
function user(){const id=randomUUID();db.prepare('INSERT INTO "user"(id,name,email,created_at) VALUES (?,?,?,?)').run(id,id,id+"@example.test",Date.now());return id;}
function fixture(){const owner=user(),other=user();const workspace=createWorkspace(owner,{name:"Test workspace"});return {owner,other,...workspace};}
function join(owner:string,id:string,other:string,role="MEMBER"){const invite=createInvitation(owner,id,{role});return acceptInvitation(other,invite.path.split("/").at(-1)!);}
it("lists only the homepage user's memberships with their general-channel destinations", () => {
 const actor=user(),foreign=user(),one=createWorkspace(actor,{name:"First workspace"}),two=createWorkspace(actor,{name:"Second workspace"});
 const privateWorkspace=createWorkspace(foreign,{name:"Private workspace"});
 expect(listHomeWorkspaces(actor)).toEqual(expect.arrayContaining([
  {id:one.id,name:"First workspace",channelId:one.channelId},
  {id:two.id,name:"Second workspace",channelId:two.channelId},
 ]));
 expect(listHomeWorkspaces(actor)).toHaveLength(2);
 expect(listHomeWorkspaces(actor).some(w=>w.id===privateWorkspace.id)).toBe(false);
});
it("claims only the supplied legacy capability and preserves historical rows and ordering", () => {
 const actor=user(),outsider=user(),legacy=randomUUID(),room=randomUUID(),member=randomUUID(),job=randomUUID(),artifact=randomUUID();
 db.prepare("INSERT INTO workspaces(id,name,unclaimed_legacy,created_at) VALUES (?,'Historical fixture',1,?)").run(legacy,Date.now());
 db.prepare("INSERT INTO rooms(id,name,created_at,next_seq) VALUES (?,'Historical fixture','2024-01-01',9)").run(room);
 db.prepare("INSERT INTO channels(id,workspace_id,name,is_general) VALUES (?,?,'general',1)").run(room,legacy);
 db.prepare("INSERT INTO legacy_room_links(old_room_id,channel_id) VALUES (?,?)").run(room,room);
 db.prepare("INSERT INTO members(id,room_id,name,color,created_at,last_seen) VALUES (?,?,'Original member','#555555','2024-01-01','2024-01-01')").run(member,room);
 db.prepare("INSERT INTO agent_jobs(id,room_id,requester_id,requester_name,prompt,idempotency_key,status,created_at,updated_at) VALUES (?,?,?,'Original member','Fixture prompt',?,'completed','2024-01-01','2024-01-02')").run(job,room,member,randomUUID());
 db.prepare("INSERT INTO messages(id,room_id,author_id,author_name,content,kind,created_at,seq) VALUES (?,?,?,'Original member','Original human fixture','human','2024-01-01',3)").run(randomUUID(),room,member);
 db.prepare("INSERT INTO messages(id,room_id,author_id,author_name,content,kind,created_at,seq,job_id) VALUES (?,?,'agent','Room agent','Original AI fixture','agent','2024-01-02',7,?)").run(randomUUID(),room,job);
 db.prepare("INSERT INTO room_events(room_id,seq,type,payload,created_at) VALUES (?,9,'artifact','{}','2024-01-02')").run(room);
 db.prepare("INSERT INTO artifacts(id,room_id,title,type,language,content,version,updated_by,updated_at) VALUES (?,?,'Original notes','document','markdown','Original artifact fixture',2,'Original member','2024-01-02')").run(artifact,room);
 db.prepare("INSERT INTO artifact_versions(room_id,artifact_id,version,title,type,language,content,updated_by,updated_at) VALUES (?,?,1,'Original notes','document','markdown','Earlier fixture','Original member','2024-01-01')").run(room,artifact);
 const history=()=>Object.fromEntries(["rooms","members","room_events","messages","agent_jobs","artifacts","artifact_versions"].map(table=>[table,db.prepare('SELECT * FROM '+table+' WHERE '+(table==="rooms"?"id":"room_id")+'=? ORDER BY rowid').all(room)]));
 const before=history();
 expect(listHomeWorkspaces(actor).some(w=>w.id===legacy)).toBe(false);
 expect(()=>channelSnapshot(actor,legacy,room)).toThrow("Not found");
 expect(claimLegacy(actor,room)).toMatchObject({id:room,workspaceId:legacy});
 expect(claimLegacy(actor,room)).toMatchObject({id:room});
 const snapshot=channelSnapshot(actor,legacy,room);
 expect(snapshot.messages).toMatchObject([{content:"Original human fixture",seq:3},{content:"Original AI fixture",seq:7}]);
 expect(snapshot.artifacts).toMatchObject([{content:"Original artifact fixture",version:2}]);
 expect(snapshot.versions).toMatchObject([{content:"Earlier fixture",version:1}]);
 expect(history()).toEqual(before);
 expect(listHomeWorkspaces(actor)).toContainEqual({id:legacy,name:"Historical fixture",channelId:room});
 expect(()=>claimLegacy(outsider,room)).toThrow("Not found");
 expect(()=>channelSnapshot(outsider,legacy,room)).toThrow("Not found");
 expect(db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE workspace_id=?").get(legacy)).toEqual({n:1});
});
describe("workspace boundaries",()=>{
 it("creates OWNER membership and general atomically, hides unrelated workspaces",()=>{
  const a=fixture();expect(requireRole(a.owner,a.id)).toBe("OWNER");expect(getWorkspace(a.owner,a.id).channels).toMatchObject([{name:"general",isGeneral:1}]);
  expect(listWorkspaces(a.other)).toEqual([]);expect(()=>getWorkspace(a.other,a.id)).toThrow("Not found");expect(()=>channelScope(a.other,a.id,a.channelId)).toThrow("Not found");
  const before=(db.prepare("SELECT COUNT(*) AS n FROM workspaces").get() as {n:number}).n;
  expect(()=>createWorkspace("missing-user",{name:"Rollback"})).toThrow();expect((db.prepare("SELECT COUNT(*) AS n FROM workspaces").get() as {n:number}).n).toBe(before);
 });
 it("scopes channel access by both workspace and membership",()=>{
  const a=fixture(),b=fixture();expect(()=>channelScope(a.owner,a.id,b.channelId)).toThrow();expect(()=>channelScope(a.owner,b.id,b.channelId,"write")).toThrow();
 });
 it("keeps other members' email addresses out of member responses",()=>{
  const a=fixture();join(a.owner,a.id,a.other);const view=getWorkspace(a.other,a.id);
  expect(view.members.find(m=>m.id===a.owner)).not.toHaveProperty("email");expect(view.members.find(m=>m.id===a.other)).toHaveProperty("email");expect(getWorkspace(a.owner,a.id).members.every(m=>"email" in m)).toBe(true);
 });
 it("enforces owner/admin/member boundaries centrally",()=>{
  for(const action of ["settings","member:role","workspace:delete","channel:manage","invite"] as const)expect(can("MEMBER",action)).toBe(false);
  expect(can("ADMIN","member:remove",{targetRole:"MEMBER"})).toBe(true);for(const role of ["OWNER","ADMIN"] as const)expect(can("ADMIN","member:remove",{targetRole:role})).toBe(false);
  expect(can("ADMIN","invite",{inviteRole:"OWNER"})).toBe(false);
  const a=fixture();join(a.owner,a.id,a.other,"ADMIN");expect(()=>changeMember(a.other,a.id,a.owner)).toThrow();expect(()=>changeMember(a.other,a.id,a.owner,"MEMBER")).toThrow();expect(()=>requireRole(a.other,a.id,"settings")).toThrow();const anotherAdmin=user();join(a.owner,a.id,anotherAdmin,"ADMIN");expect(()=>changeMember(a.other,a.id,anotherAdmin)).toThrow();expect(()=>changeMember(a.other,a.id,anotherAdmin,"MEMBER")).toThrow();
 });
 it("protects the last owner and transfers ownership transactionally",()=>{
  const a=fixture();join(a.owner,a.id,a.other);expect(()=>changeMember(a.owner,a.id,a.owner)).toThrow("last owner");expect(()=>changeMember(a.owner,a.id,a.owner,"ADMIN")).toThrow("last owner");
  transferOwnership(a.owner,a.id,a.other);expect(requireRole(a.other,a.id)).toBe("OWNER");expect(requireRole(a.owner,a.id)).toBe("MEMBER");changeMember(a.owner,a.id,a.owner);expect(()=>requireRole(a.owner,a.id)).toThrow();
 });
 it("requires exact typed deletion and cascades all workspace content",()=>{
  const a=fixture();expect(()=>deleteWorkspace(a.owner,a.id,"wrong")).toThrow();deleteWorkspace(a.owner,a.id,"Test workspace");expect(()=>getWorkspace(a.owner,a.id)).toThrow();expect(db.prepare("SELECT 1 FROM rooms WHERE id=?").get(a.channelId)).toBeUndefined();
 });
 it("claims a legacy workspace exactly once without exposing it in listings",()=>{
  const a=fixture(),legacy=randomUUID(),channel=randomUUID();db.prepare("INSERT INTO workspaces(id,name,unclaimed_legacy,created_at) VALUES (?,'Legacy',1,?)").run(legacy,Date.now());db.prepare("INSERT INTO rooms(id,name) VALUES (?,'Legacy')").run(channel);db.prepare("INSERT INTO channels(id,workspace_id,name,is_general) VALUES (?,?,'general',1)").run(channel,legacy);db.prepare("INSERT INTO legacy_room_links(old_room_id,channel_id) VALUES (?,?)").run(channel,channel);
  expect(listWorkspaces(a.owner).some(w=>w.id===legacy)).toBe(false);expect(claimLegacy(a.owner,channel).workspaceId).toBe(legacy);expect(requireRole(a.owner,legacy)).toBe("OWNER");expect(()=>claimLegacy(a.other,channel)).toThrow();
 });
});
describe("invitations",()=>{
 it("stores a hash, enforces single use and accepts existing members idempotently",()=>{
  const a=fixture(),third=user();const invite=createInvitation(a.owner,a.id,{}),token=invite.path.split("/").at(-1)!;
  expect(JSON.stringify(listInvitations(a.owner,a.id))).not.toContain(token);expect((db.prepare("SELECT token_hash FROM invitations WHERE id=?").get(invite.id) as {token_hash:string}).token_hash).not.toBe(token);
  acceptInvitation(a.other,token);expect(()=>acceptInvitation(third,token)).toThrow("unavailable");expect(acceptInvitation(a.other,token).workspaceId).toBe(a.id);expect((db.prepare("SELECT uses FROM invitations WHERE id=?").get(invite.id) as {uses:number}).uses).toBe(1);
 });
 it("rejects expired and revoked invitations without disclosing workspace details",()=>{
  const a=fixture();for(const kind of ["expired","revoked"]){const invite=createInvitation(a.owner,a.id,{});if(kind==="expired")db.prepare("UPDATE invitations SET expires_at=0 WHERE id=?").run(invite.id);else revokeInvitation(a.owner,a.id,invite.id);expect(()=>acceptInvitation(a.other,invite.path.split("/").at(-1)!)).toThrow("This invitation is unavailable.");}
 });
 it("permits ADMIN invitations only with MEMBER role",()=>{
  const a=fixture();join(a.owner,a.id,a.other,"ADMIN");expect(()=>createInvitation(a.other,a.id,{role:"ADMIN"})).toThrow();expect(()=>createInvitation(a.other,a.id,{role:"OWNER"})).toThrow();expect(createInvitation(a.other,a.id,{}).path).toMatch(/^\/invite\//);
 });
});

it("binds optional invitation email to a provider-verified authenticated account",()=>{
 const owner=user(),person=user(),w=createWorkspace(owner,{name:"Bound email"});const email=(db.prepare('SELECT email FROM "user" WHERE id=?').get(person) as {email:string}).email;
 const invite=createInvitation(owner,w.id,{email});const token=invite.path.split("/").at(-1)!;expect(()=>acceptInvitation(person,token)).toThrow("unavailable");db.prepare('UPDATE "user" SET emailVerified=? WHERE id=?').run(Date.now(),person);expect(acceptInvitation(person,token).workspaceId).toBe(w.id);
});
