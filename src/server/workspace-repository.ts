import { removeAvatarFiles } from "./avatar-storage";
﻿import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { can, type Role, type Action } from "./permissions";
import { HttpError,resourceId } from "./http-security";
import { evictWorkspaceUser } from "./workspace-sockets";
export const WorkspaceInput=z.object({name:z.string().trim().min(1).max(60).regex(/^[^\u0000-\u001F\u007F]+$/),avatar:z.enum(["violet","blue","green","orange"]).default("violet")}).strict();
export type Workspace={id:string;name:string;avatar:string;role:Role};
export async function requireRole(actor:string,workspace:string,action:Action="read",resource:{targetRole?:Role;inviteRole?:Role}={}) {
  resourceId(workspace);
  const member=(await db.prepare("SELECT role FROM memberships WHERE workspace_id=? AND user_id=?").get(workspace,actor)) as {role:Role}|undefined;
  if(!member) throw new HttpError(404,"Not found.");
  if(!can(member.role,action,resource)) throw new HttpError(403,"This action is not allowed.");
  return member.role;
}
export async function audit(workspace:string,actor:string,action:string,detail:unknown={}) {
  (await db.prepare("INSERT INTO audit_log(id,workspace_id,actor_id,action,detail,created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(),workspace,actor,action,JSON.stringify(detail),Date.now()));
}
export async function listWorkspaces(actor:string) {
  return (await db.prepare("SELECT w.id,w.name,w.avatar,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.created_at,w.id").all(actor)) as Workspace[];
}
export type HomeWorkspace = { id: string; name: string; channelId: string };
export async function listHomeWorkspaces(actor: string) {
  return (await db.prepare("SELECT w.id,w.name,c.id AS channelId FROM workspaces w JOIN memberships m ON m.workspace_id=w.id JOIN channels c ON c.workspace_id=w.id AND c.is_general=1 AND c.visibility='public' WHERE m.user_id=? ORDER BY w.created_at,w.id").all(actor)) as HomeWorkspace[];
}
export async function createWorkspace(actor:string,input:unknown) {
  const parsed=WorkspaceInput.parse(input);
  return (await db.transaction(async ()=>{
    const workspace=randomUUID(),channel=randomUUID();
    (await db.prepare("INSERT INTO workspaces(id,name,avatar,created_at) VALUES (?,?,?,?)").run(workspace,parsed.name,parsed.avatar,Date.now()));
    (await db.prepare("INSERT INTO memberships(workspace_id,user_id,role,created_at) VALUES (?,?,'OWNER',?)").run(workspace,actor,Date.now()));
    (await db.prepare("INSERT INTO rooms(id,name) VALUES (?,?)").run(channel,"general"));
    (await db.prepare("INSERT INTO channels(id,workspace_id,name,is_general) VALUES (?,?,'general',1)").run(channel,workspace));
    (await audit(workspace,actor,"workspace:create"));
    return {id:workspace,channelId:channel};
  }).immediate());
}
export async function getWorkspace(actor:string,workspace:string) {
  const role=(await requireRole(actor,workspace));
  const row=(await db.prepare("SELECT id,name,avatar FROM workspaces WHERE id=?").get(workspace)) as Omit<Workspace,"role">;
  const channels=(await db.prepare("SELECT id,name,archived,is_general AS isGeneral FROM channels WHERE workspace_id=? AND visibility='public' ORDER BY is_general DESC,name").all(workspace)) as {id:string;name:string;archived:number;isGeneral:number}[];
  const members=(await db.prepare('SELECT u.id,u.name,u.image,m.role FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.created_at').all(workspace)) as {id:string;name:string|null;image:string|null;role:Role;email?:string|null}[];
  for(const member of members) if(member.id===actor || can(role,"email:read")) member.email=((await db.prepare('SELECT email FROM "user" WHERE id=?').get(member.id)) as {email:string|null}).email;
  return {...row,role,channels,members};
}
export async function channelScope(actor:string,workspace:string,channel:string,action:Action="read") {
  (await requireRole(actor,workspace,action));resourceId(channel);
  const result=(await db.prepare("SELECT id,name,workspace_id AS workspaceId,archived FROM channels WHERE workspace_id=? AND id=? AND visibility='public'").get(workspace,channel)) as {id:string;name:string;workspaceId:string;archived:number}|undefined;
  if(!result || (action!=="read" && result.archived)) throw new HttpError(404,"Not found.");
  return result;
}
export async function channelForActor(actor:string,channel:string,action:Action="read") {
  const row=(await db.prepare("SELECT workspace_id FROM channels WHERE id=?").get(channel)) as {workspace_id:string}|undefined;
  if(!row) throw new HttpError(404,"Not found.");
  return (await channelScope(actor,row.workspace_id,channel,action));
}
export async function claimLegacy(actor:string,oldRoom:string) {
  resourceId(oldRoom);
  return (await db.transaction(async ()=>{
    const row=(await db.prepare("SELECT c.workspace_id AS workspace,w.unclaimed_legacy AS unclaimed FROM legacy_room_links l JOIN channels c ON c.id=l.channel_id JOIN workspaces w ON w.id=c.workspace_id WHERE l.old_room_id=?").get(oldRoom)) as {workspace:string;unclaimed:number}|undefined;
    if(!row) return (await channelForActor(actor,oldRoom));
    if(row.unclaimed) {
      (await db.prepare("INSERT INTO memberships(workspace_id,user_id,role,created_at) VALUES (?,?,'OWNER',?)").run(row.workspace,actor,Date.now()));
      (await db.prepare("UPDATE workspaces SET unclaimed_legacy=0 WHERE id=?").run(row.workspace));
      (await audit(row.workspace,actor,"legacy:claim"));
    }
    return (await channelScope(actor,row.workspace,oldRoom));
  }).immediate());
}
export async function changeWorkspace(actor:string,workspace:string,input:unknown) {
 const parsed=z.object({name:WorkspaceInput.shape.name,avatar:z.string().max(80)}).strict().parse(input);
 const obsolete=(await db.transaction(async ()=>{
  (await requireRole(actor,workspace,"workspace:manage"));
  const current=(await db.prepare("SELECT avatar FROM workspaces WHERE id=?").get(workspace)) as {avatar:string};
  if(!["violet","blue","green","orange"].includes(parsed.avatar)&&parsed.avatar!==current.avatar)throw new HttpError(400,"Invalid avatar.");
  (await db.prepare("UPDATE workspaces SET name=?,avatar=? WHERE id=?").run(parsed.name,parsed.avatar,workspace));
  const old=(await db.prepare("SELECT filename FROM workspace_avatar_files WHERE workspace_id=? AND filename<>?").all(workspace,parsed.avatar)) as {filename:string}[];
  (await db.prepare("DELETE FROM workspace_avatar_files WHERE workspace_id=? AND filename<>?").run(workspace,parsed.avatar));
  (await audit(workspace,actor,"workspace:update"));return old.map(p=>p.filename);
 }).immediate());
 return (await removeAvatarFiles(obsolete));
}

async function retainOwner(workspace:string,user:string) {
  const target=(await db.prepare("SELECT role FROM memberships WHERE workspace_id=? AND user_id=?").get(workspace,user)) as {role:Role}|undefined;
  if(!target) throw new HttpError(404,"Not found.");
  if(target.role==="OWNER" && ((await db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE workspace_id=? AND role='OWNER'").get(workspace)) as {n:number}).n<=1) throw new HttpError(409,"Transfer ownership before the last owner leaves or is removed.");
}
export async function changeMember(actor:string,workspace:string,user:string,role?:Role) {
  (await db.transaction(async ()=>{
    (await requireRole(actor,workspace));
    const target=(await db.prepare("SELECT role FROM memberships WHERE workspace_id=? AND user_id=?").get(workspace,user)) as {role:Role}|undefined;
    if(!target) throw new HttpError(404,"Not found.");
    if(role) (await requireRole(actor,workspace,"member:role",{targetRole:target.role}));
    else if(user!==actor) (await requireRole(actor,workspace,"member:remove",{targetRole:target.role}));
    if(role!=="OWNER") (await retainOwner(workspace,user));
    if(role) (await db.prepare("UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?").run(role,workspace,user));
    else (await db.prepare("DELETE FROM memberships WHERE workspace_id=? AND user_id=?").run(workspace,user));
    (await audit(workspace,actor,role?"member:role":"member:remove",{user,role}));
  }).immediate());
  evictWorkspaceUser(workspace,user);
}
export async function transferOwnership(actor:string,workspace:string,user:string) {
  (await db.transaction(async ()=>{
    (await requireRole(actor,workspace,"member:role"));
    if(user===actor) throw new HttpError(400,"Select another member.");
    const changed=(await db.prepare("UPDATE memberships SET role='OWNER' WHERE workspace_id=? AND user_id=?").run(workspace,user));
    if(!changed.changes) throw new HttpError(404,"Not found.");
    (await db.prepare("UPDATE memberships SET role='MEMBER' WHERE workspace_id=? AND user_id=?").run(workspace,actor));
    (await audit(workspace,actor,"ownership:transfer",{user}));
  }).immediate());
  evictWorkspaceUser(workspace);
}
export async function deleteWorkspace(actor:string,workspace:string,confirmation:string) {
  let files:string[]=[];
  (await db.transaction(async ()=>{
    (await requireRole(actor,workspace,"workspace:delete"));
    const row=(await db.prepare("SELECT name FROM workspaces WHERE id=?").get(workspace)) as {name:string};
    if(confirmation!==row.name) throw new HttpError(400,"Type the workspace name to confirm deletion.");
    files=((await db.prepare("SELECT filename FROM workspace_avatar_files WHERE workspace_id=?").all(workspace)) as {filename:string}[]).map(row=>row.filename);
    (await audit(workspace,actor,"workspace:delete",{workspace}));
    const channels=(await db.prepare("SELECT id FROM channels WHERE workspace_id=?").all(workspace)) as {id:string}[];
    for(const channel of channels) (await db.prepare("DELETE FROM rooms WHERE id=?").run(channel.id));
    (await db.prepare("DELETE FROM workspaces WHERE id=?").run(workspace));
  }).immediate());
  evictWorkspaceUser(workspace);
  return (await removeAvatarFiles(files));
}
export const InvitationInput=z.object({role:z.enum(["OWNER","ADMIN","MEMBER"]).default("MEMBER"),days:z.number().int().min(1).max(30).default(7),maxUses:z.number().int().min(1).max(100).default(1),email:z.email().max(254).optional()}).strict();
const tokenHash=(token:string)=>createHash("sha256").update(token).digest("hex");
export async function createInvitation(actor:string,workspace:string,input:unknown) {
  const parsed=InvitationInput.parse(input);
  return (await db.transaction(async ()=>{
    (await requireRole(actor,workspace,"invite",{inviteRole:parsed.role}));
    const token=randomBytes(32).toString("base64url"),id=randomUUID();
    (await db.prepare("INSERT INTO invitations(id,workspace_id,token_hash,role,expires_at,max_uses,email,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id,workspace,tokenHash(token),parsed.role,Date.now()+parsed.days*86400000,parsed.maxUses,parsed.email?.toLowerCase()??null,actor,Date.now()));
    (await audit(workspace,actor,"invitation:create",{id,role:parsed.role}));
    return {id,path:"/invite/"+token};
  }).immediate());
}
export async function listInvitations(actor:string,workspace:string) {
  (await requireRole(actor,workspace,"invite"));
  return (await db.prepare("SELECT id,role,expires_at AS expiresAt,max_uses AS maxUses,uses,revoked,email FROM invitations WHERE workspace_id=? ORDER BY created_at DESC").all(workspace));
}
export async function revokeInvitation(actor:string,workspace:string,id:string) {
  (await db.transaction(async ()=>{
    (await requireRole(actor,workspace,"invite"));
    (await db.prepare("UPDATE invitations SET revoked=1 WHERE workspace_id=? AND id=?").run(workspace,id));
    (await audit(workspace,actor,"invitation:revoke",{id}));
  }).immediate());
}
export async function acceptInvitation(actor:string,token:string) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(404,"This invitation is unavailable.");
  return (await db.transaction(async ()=>{
    const invite=(await db.prepare("SELECT * FROM invitations WHERE token_hash=?").get(tokenHash(token))) as {id:string;workspace_id:string;role:Role;expires_at:number;max_uses:number;uses:number;revoked:number;email:string|null}|undefined;
    if(!invite) throw new HttpError(404,"This invitation is unavailable.");
    const member=(await db.prepare("SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?").get(invite.workspace_id,actor));
    if(!member) {
      if(invite.revoked || invite.expires_at<=Date.now() || invite.uses>=invite.max_uses) throw new HttpError(404,"This invitation is unavailable.");
      if(invite.email) {
        const user=(await db.prepare('SELECT email,emailVerified FROM "user" WHERE id=?').get(actor)) as {email:string|null;emailVerified:number|null}|undefined;
        if(!user?.emailVerified || user.email?.toLowerCase()!==invite.email) throw new HttpError(404,"This invitation is unavailable.");
      }
      (await db.prepare("INSERT INTO memberships(workspace_id,user_id,role,created_at) VALUES (?,?,?,?)").run(invite.workspace_id,actor,invite.role,Date.now()));
      (await db.prepare("UPDATE invitations SET uses=uses+1 WHERE id=? AND uses<max_uses").run(invite.id));
      (await audit(invite.workspace_id,actor,"invitation:accept",{id:invite.id}));
    }
    const channel=(await db.prepare("SELECT id FROM channels WHERE workspace_id=? AND is_general=1").get(invite.workspace_id)) as {id:string};
    return {workspaceId:invite.workspace_id,channelId:channel.id};
  }).immediate());
}
export async function invitationAvailable(actor:string,token:string){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))return false;
 const invite=(await db.prepare("SELECT workspace_id,expires_at,max_uses,uses,revoked,email FROM invitations WHERE token_hash=?").get(tokenHash(token))) as {workspace_id:string;expires_at:number;max_uses:number;uses:number;revoked:number;email:string|null}|undefined;
 if(!invite)return false;
 if((await db.prepare("SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?").get(invite.workspace_id,actor)))return true;
 if(invite.revoked||invite.expires_at<=Date.now()||invite.uses>=invite.max_uses)return false;
 if(invite.email){const user=(await db.prepare('SELECT email,emailVerified FROM "user" WHERE id=?').get(actor)) as {email:string|null;emailVerified:number|null}|undefined;return Boolean(user?.emailVerified&&user.email?.toLowerCase()===invite.email);}
 return true;
}
