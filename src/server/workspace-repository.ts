import { removeAvatarFiles } from "./avatar-storage";
﻿import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { can, type Role, type Action } from "./permissions";
import { HttpError,resourceId } from "./http-security";
import { evictWorkspaceUser } from "./workspace-sockets";
export const WorkspaceInput=z.object({name:z.string().trim().min(1).max(60).regex(/^[^\u0000-\u001F\u007F]+$/),avatar:z.enum(["violet","blue","green","orange"]).default("violet")}).strict();
export type Workspace={id:string;name:string;avatar:string;role:Role};
export function requireRole(actor:string,workspace:string,action:Action="read",resource:{targetRole?:Role;inviteRole?:Role}={}) {
  resourceId(workspace);
  const member=db.prepare("SELECT role FROM memberships WHERE workspace_id=? AND user_id=?").get(workspace,actor) as {role:Role}|undefined;
  if(!member) throw new HttpError(404,"Not found.");
  if(!can(member.role,action,resource)) throw new HttpError(403,"This action is not allowed.");
  return member.role;
}
export function audit(workspace:string,actor:string,action:string,detail:unknown={}) {
  db.prepare("INSERT INTO audit_log(id,workspace_id,actor_id,action,detail,created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(),workspace,actor,action,JSON.stringify(detail),Date.now());
}
export function listWorkspaces(actor:string) {
  return db.prepare("SELECT w.id,w.name,w.avatar,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.created_at,w.id").all(actor) as Workspace[];
}
export type HomeWorkspace = { id: string; name: string; channelId: string };
export function listHomeWorkspaces(actor: string) {
  return db.prepare("SELECT w.id,w.name,c.id AS channelId FROM workspaces w JOIN memberships m ON m.workspace_id=w.id JOIN channels c ON c.workspace_id=w.id AND c.is_general=1 AND c.visibility='public' WHERE m.user_id=? ORDER BY w.created_at,w.id").all(actor) as HomeWorkspace[];
}
export function createWorkspace(actor:string,input:unknown) {
  const parsed=WorkspaceInput.parse(input);
  return db.transaction(()=>{
    const workspace=randomUUID(),channel=randomUUID();
    db.prepare("INSERT INTO workspaces(id,name,avatar,created_at) VALUES (?,?,?,?)").run(workspace,parsed.name,parsed.avatar,Date.now());
    db.prepare("INSERT INTO memberships(workspace_id,user_id,role,created_at) VALUES (?,?,'OWNER',?)").run(workspace,actor,Date.now());
    db.prepare("INSERT INTO rooms(id,name) VALUES (?,?)").run(channel,"general");
    db.prepare("INSERT INTO channels(id,workspace_id,name,is_general) VALUES (?,?,'general',1)").run(channel,workspace);
    audit(workspace,actor,"workspace:create");
    return {id:workspace,channelId:channel};
  }).immediate();
}
export function getWorkspace(actor:string,workspace:string) {
  const role=requireRole(actor,workspace);
  const row=db.prepare("SELECT id,name,avatar FROM workspaces WHERE id=?").get(workspace) as Omit<Workspace,"role">;
  const channels=db.prepare("SELECT id,name,archived,is_general AS isGeneral FROM channels WHERE workspace_id=? AND visibility='public' ORDER BY is_general DESC,name").all(workspace) as {id:string;name:string;archived:number;isGeneral:number}[];
  const members=db.prepare('SELECT u.id,u.name,u.image,m.role FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.created_at').all(workspace) as {id:string;name:string|null;image:string|null;role:Role;email?:string|null}[];
  for(const member of members) if(member.id===actor || can(role,"email:read")) member.email=(db.prepare('SELECT email FROM "user" WHERE id=?').get(member.id) as {email:string|null}).email;
  return {...row,role,channels,members};
}
export function channelScope(actor:string,workspace:string,channel:string,action:Action="read") {
  requireRole(actor,workspace,action);resourceId(channel);
  const result=db.prepare("SELECT id,name,workspace_id AS workspaceId,archived FROM channels WHERE workspace_id=? AND id=? AND visibility='public'").get(workspace,channel) as {id:string;name:string;workspaceId:string;archived:number}|undefined;
  if(!result || (action!=="read" && result.archived)) throw new HttpError(404,"Not found.");
  return result;
}
export function channelForActor(actor:string,channel:string,action:Action="read") {
  const row=db.prepare("SELECT workspace_id FROM channels WHERE id=?").get(channel) as {workspace_id:string}|undefined;
  if(!row) throw new HttpError(404,"Not found.");
  return channelScope(actor,row.workspace_id,channel,action);
}
export function claimLegacy(actor:string,oldRoom:string) {
  resourceId(oldRoom);
  return db.transaction(()=>{
    const row=db.prepare("SELECT c.workspace_id AS workspace,w.unclaimed_legacy AS unclaimed FROM legacy_room_links l JOIN channels c ON c.id=l.channel_id JOIN workspaces w ON w.id=c.workspace_id WHERE l.old_room_id=?").get(oldRoom) as {workspace:string;unclaimed:number}|undefined;
    if(!row) return channelForActor(actor,oldRoom);
    if(row.unclaimed) {
      db.prepare("INSERT INTO memberships(workspace_id,user_id,role,created_at) VALUES (?,?,'OWNER',?)").run(row.workspace,actor,Date.now());
      db.prepare("UPDATE workspaces SET unclaimed_legacy=0 WHERE id=?").run(row.workspace);
      audit(row.workspace,actor,"legacy:claim");
    }
    return channelScope(actor,row.workspace,oldRoom);
  }).immediate();
}
export function changeWorkspace(actor:string,workspace:string,input:unknown) {
 const parsed=z.object({name:WorkspaceInput.shape.name,avatar:z.string().max(80)}).strict().parse(input);
 const obsolete=db.transaction(()=>{
  requireRole(actor,workspace,"workspace:manage");
  const current=db.prepare("SELECT avatar FROM workspaces WHERE id=?").get(workspace) as {avatar:string};
  if(!["violet","blue","green","orange"].includes(parsed.avatar)&&parsed.avatar!==current.avatar)throw new HttpError(400,"Invalid avatar.");
  db.prepare("UPDATE workspaces SET name=?,avatar=? WHERE id=?").run(parsed.name,parsed.avatar,workspace);
  const old=db.prepare("SELECT filename FROM workspace_avatar_files WHERE workspace_id=? AND filename<>?").all(workspace,parsed.avatar) as {filename:string}[];
  db.prepare("DELETE FROM workspace_avatar_files WHERE workspace_id=? AND filename<>?").run(workspace,parsed.avatar);
  audit(workspace,actor,"workspace:update");return old.map(p=>p.filename);
 }).immediate();
 return removeAvatarFiles(obsolete);
}

function retainOwner(workspace:string,user:string) {
  const target=db.prepare("SELECT role FROM memberships WHERE workspace_id=? AND user_id=?").get(workspace,user) as {role:Role}|undefined;
  if(!target) throw new HttpError(404,"Not found.");
  if(target.role==="OWNER" && (db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE workspace_id=? AND role='OWNER'").get(workspace) as {n:number}).n<=1) throw new HttpError(409,"Transfer ownership before the last owner leaves or is removed.");
}
export function changeMember(actor:string,workspace:string,user:string,role?:Role) {
  db.transaction(()=>{
    requireRole(actor,workspace);
    const target=db.prepare("SELECT role FROM memberships WHERE workspace_id=? AND user_id=?").get(workspace,user) as {role:Role}|undefined;
    if(!target) throw new HttpError(404,"Not found.");
    if(role) requireRole(actor,workspace,"member:role",{targetRole:target.role});
    else if(user!==actor) requireRole(actor,workspace,"member:remove",{targetRole:target.role});
    if(role!=="OWNER") retainOwner(workspace,user);
    if(role) db.prepare("UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?").run(role,workspace,user);
    else db.prepare("DELETE FROM memberships WHERE workspace_id=? AND user_id=?").run(workspace,user);
    audit(workspace,actor,role?"member:role":"member:remove",{user,role});
  }).immediate();
  evictWorkspaceUser(workspace,user);
}
export function transferOwnership(actor:string,workspace:string,user:string) {
  db.transaction(()=>{
    requireRole(actor,workspace,"member:role");
    if(user===actor) throw new HttpError(400,"Select another member.");
    const changed=db.prepare("UPDATE memberships SET role='OWNER' WHERE workspace_id=? AND user_id=?").run(workspace,user);
    if(!changed.changes) throw new HttpError(404,"Not found.");
    db.prepare("UPDATE memberships SET role='MEMBER' WHERE workspace_id=? AND user_id=?").run(workspace,actor);
    audit(workspace,actor,"ownership:transfer",{user});
  }).immediate();
  evictWorkspaceUser(workspace);
}
export function deleteWorkspace(actor:string,workspace:string,confirmation:string) {
  let files:string[]=[];
  db.transaction(()=>{
    requireRole(actor,workspace,"workspace:delete");
    const row=db.prepare("SELECT name FROM workspaces WHERE id=?").get(workspace) as {name:string};
    if(confirmation!==row.name) throw new HttpError(400,"Type the workspace name to confirm deletion.");
    files=(db.prepare("SELECT filename FROM workspace_avatar_files WHERE workspace_id=?").all(workspace) as {filename:string}[]).map(row=>row.filename);
    audit(workspace,actor,"workspace:delete",{workspace});
    const channels=db.prepare("SELECT id FROM channels WHERE workspace_id=?").all(workspace) as {id:string}[];
    for(const channel of channels) db.prepare("DELETE FROM rooms WHERE id=?").run(channel.id);
    db.prepare("DELETE FROM workspaces WHERE id=?").run(workspace);
  }).immediate();
  evictWorkspaceUser(workspace);
  return removeAvatarFiles(files);
}
export const InvitationInput=z.object({role:z.enum(["OWNER","ADMIN","MEMBER"]).default("MEMBER"),days:z.number().int().min(1).max(30).default(7),maxUses:z.number().int().min(1).max(100).default(1),email:z.email().max(254).optional()}).strict();
const tokenHash=(token:string)=>createHash("sha256").update(token).digest("hex");
export function createInvitation(actor:string,workspace:string,input:unknown) {
  const parsed=InvitationInput.parse(input);
  return db.transaction(()=>{
    requireRole(actor,workspace,"invite",{inviteRole:parsed.role});
    const token=randomBytes(32).toString("base64url"),id=randomUUID();
    db.prepare("INSERT INTO invitations(id,workspace_id,token_hash,role,expires_at,max_uses,email,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id,workspace,tokenHash(token),parsed.role,Date.now()+parsed.days*86400000,parsed.maxUses,parsed.email?.toLowerCase()??null,actor,Date.now());
    audit(workspace,actor,"invitation:create",{id,role:parsed.role});
    return {id,path:"/invite/"+token};
  }).immediate();
}
export function listInvitations(actor:string,workspace:string) {
  requireRole(actor,workspace,"invite");
  return db.prepare("SELECT id,role,expires_at AS expiresAt,max_uses AS maxUses,uses,revoked,email FROM invitations WHERE workspace_id=? ORDER BY created_at DESC").all(workspace);
}
export function revokeInvitation(actor:string,workspace:string,id:string) {
  db.transaction(()=>{
    requireRole(actor,workspace,"invite");
    db.prepare("UPDATE invitations SET revoked=1 WHERE workspace_id=? AND id=?").run(workspace,id);
    audit(workspace,actor,"invitation:revoke",{id});
  }).immediate();
}
export function acceptInvitation(actor:string,token:string) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(404,"This invitation is unavailable.");
  return db.transaction(()=>{
    const invite=db.prepare("SELECT * FROM invitations WHERE token_hash=?").get(tokenHash(token)) as {id:string;workspace_id:string;role:Role;expires_at:number;max_uses:number;uses:number;revoked:number;email:string|null}|undefined;
    if(!invite) throw new HttpError(404,"This invitation is unavailable.");
    const member=db.prepare("SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?").get(invite.workspace_id,actor);
    if(!member) {
      if(invite.revoked || invite.expires_at<=Date.now() || invite.uses>=invite.max_uses) throw new HttpError(404,"This invitation is unavailable.");
      if(invite.email) {
        const user=db.prepare('SELECT email,emailVerified FROM "user" WHERE id=?').get(actor) as {email:string|null;emailVerified:number|null}|undefined;
        if(!user?.emailVerified || user.email?.toLowerCase()!==invite.email) throw new HttpError(404,"This invitation is unavailable.");
      }
      db.prepare("INSERT INTO memberships(workspace_id,user_id,role,created_at) VALUES (?,?,?,?)").run(invite.workspace_id,actor,invite.role,Date.now());
      db.prepare("UPDATE invitations SET uses=uses+1 WHERE id=? AND uses<max_uses").run(invite.id);
      audit(invite.workspace_id,actor,"invitation:accept",{id:invite.id});
    }
    const channel=db.prepare("SELECT id FROM channels WHERE workspace_id=? AND is_general=1").get(invite.workspace_id) as {id:string};
    return {workspaceId:invite.workspace_id,channelId:channel.id};
  }).immediate();
}
export function invitationAvailable(actor:string,token:string){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))return false;
 const invite=db.prepare("SELECT workspace_id,expires_at,max_uses,uses,revoked,email FROM invitations WHERE token_hash=?").get(tokenHash(token)) as {workspace_id:string;expires_at:number;max_uses:number;uses:number;revoked:number;email:string|null}|undefined;
 if(!invite)return false;
 if(db.prepare("SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?").get(invite.workspace_id,actor))return true;
 if(invite.revoked||invite.expires_at<=Date.now()||invite.uses>=invite.max_uses)return false;
 if(invite.email){const user=db.prepare('SELECT email,emailVerified FROM "user" WHERE id=?').get(actor) as {email:string|null;emailVerified:number|null}|undefined;return Boolean(user?.emailVerified&&user.email?.toLowerCase()===invite.email);}
 return true;
}
