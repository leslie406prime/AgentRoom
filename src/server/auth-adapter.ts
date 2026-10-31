import type { Adapter, AdapterUser, AdapterAccount, AdapterSession } from "next-auth/adapters";
import { randomUUID } from "node:crypto";
import { db } from "./db";

function user(row:Record<string,unknown>|undefined):AdapterUser|null {
  return row?{id:String(row.id),name:row.name as string|null,email:row.email as string,emailVerified:row.emailVerified?new Date(Number(row.emailVerified)):null,image:row.image as string|null}:null;
}
function session(row:Record<string,unknown>|undefined):AdapterSession|null {
  return row?{sessionToken:String(row.sessionToken),userId:String(row.userId),expires:new Date(Number(row.expires))}:null;
}
// Auth.js retains its OAuth/CSRF/session machinery. This adapter only persists its records.
// Both drivers use the same parameterized queries and async transaction boundary.
export const authAdapter:Adapter={
  async createUser(input){
    const id=input.id??randomUUID();
    await db.prepare('INSERT INTO "user"(id,name,email,emailVerified,image,created_at) VALUES (?,?,?,?,?,?)').run(id,input.name??null,input.email,input.emailVerified?.getTime()??null,input.image??null,Date.now());
    return user(await db.prepare('SELECT * FROM "user" WHERE id=?').get(id))!;
  },
  async getUser(id){return user(await db.prepare('SELECT * FROM "user" WHERE id=?').get(id));},
  async getUserByEmail(email){return user(await db.prepare('SELECT * FROM "user" WHERE email=? ORDER BY created_at LIMIT 1').get(email));},
  async getUserByAccount({provider,providerAccountId}){return user(await db.prepare('SELECT u.* FROM "user" u JOIN account a ON a.userId=u.id WHERE a.provider=? AND a.providerAccountId=?').get(provider,providerAccountId));},
  async updateUser(input){return db.transaction(async()=>{
    const prior=await db.prepare('SELECT * FROM "user" WHERE id=?').get(input.id);if(!prior)throw new Error("User not found.");
    const value={...user(prior)!,...input};
    await db.prepare('UPDATE "user" SET name=?,email=?,emailVerified=?,image=? WHERE id=?').run(value.name??null,value.email,value.emailVerified?.getTime()??null,value.image??null,input.id);
    return user(await db.prepare('SELECT * FROM "user" WHERE id=?').get(input.id))!;
  }).immediate();},
  async deleteUser(id){await db.prepare('DELETE FROM "user" WHERE id=?').run(id);},
  async linkAccount(input){
    await db.prepare('INSERT INTO account(userId,type,provider,providerAccountId,refresh_token,access_token,expires_at,token_type,scope,id_token,session_state) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(input.userId,input.type,input.provider,input.providerAccountId,input.refresh_token??null,input.access_token??null,input.expires_at??null,input.token_type??null,input.scope??null,input.id_token??null,input.session_state??null);
    return input as AdapterAccount;
  },
  async unlinkAccount({provider,providerAccountId}){await db.prepare('DELETE FROM account WHERE provider=? AND providerAccountId=?').run(provider,providerAccountId);},
  async createSession(input){await db.prepare('INSERT INTO session(sessionToken,userId,expires) VALUES (?,?,?)').run(input.sessionToken,input.userId,input.expires.getTime());return input;},
  async getSessionAndUser(token){return db.transaction(async()=>{
    const s=session(await db.prepare('SELECT * FROM session WHERE sessionToken=?').get(token));if(!s)return null;
    const u=user(await db.prepare('SELECT * FROM "user" WHERE id=?').get(s.userId));return u?{session:s,user:u}:null;
  }).immediate();},
  async updateSession(input){return db.transaction(async()=>{
    const previous=session(await db.prepare('SELECT * FROM session WHERE sessionToken=?').get(input.sessionToken));if(!previous)return null;
    const value={...previous,...input};await db.prepare('UPDATE session SET userId=?,expires=? WHERE sessionToken=?').run(value.userId,value.expires.getTime(),value.sessionToken);return value;
  }).immediate();},
  async deleteSession(token){await db.prepare('DELETE FROM session WHERE sessionToken=?').run(token);},
  async createVerificationToken(input){await db.prepare('INSERT INTO verificationToken(identifier,token,expires) VALUES (?,?,?)').run(input.identifier,input.token,input.expires.getTime());return input;},
  async useVerificationToken({identifier,token}){return db.transaction(async()=>{const row=await db.prepare('SELECT * FROM verificationToken WHERE identifier=? AND token=?').get(identifier,token);if(!row)return null;await db.prepare('DELETE FROM verificationToken WHERE identifier=? AND token=?').run(identifier,token);return {identifier,token,expires:new Date(Number(row.expires))};}).immediate();},
};
