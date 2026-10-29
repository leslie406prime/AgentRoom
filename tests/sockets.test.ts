import { afterAll,beforeAll,expect,it } from "vitest";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";
import { io as connect,type Socket } from "socket.io-client";
import { db } from "../src/server/db";
import { registerSocketHandlers } from "../src/server/socket";
import { createWorkspace,createInvitation,acceptInvitation,changeMember } from "../src/server/workspace-repository";
const http=createServer(),io=new Server(http),sockets:Socket[]=[];
let origin:string;
beforeAll(async()=>{registerSocketHandlers(io);await new Promise<void>(resolve=>http.listen(0,"127.0.0.1",resolve));origin="http://127.0.0.1:"+(http.address() as {port:number}).port;});
afterAll(async()=>{for(const socket of sockets)socket.close();await new Promise<void>(resolve=>io.close(()=>resolve()));});
function account(expires=Date.now()+60000){const user=randomUUID(),token=randomUUID();db.prepare('INSERT INTO "user"(id,name,created_at) VALUES (?,?,?)').run(user,"Member",Date.now());db.prepare("INSERT INTO session(sessionToken,userId,expires) VALUES (?,?,?)").run(token,user,expires);return {user,token};}
async function socket(token?:string){const s=connect(origin,{extraHeaders:token?{Cookie:"authjs.session-token="+token}:{},reconnection:false,forceNew:true});sockets.push(s);return await new Promise<Socket>((resolve,reject)=>{s.once("connect",()=>resolve(s));s.once("connect_error",reject);});}
it("rejects missing and expired socket sessions",async()=>{await expect(socket()).rejects.toThrow("Authentication required");await expect(socket(account(0).token)).rejects.toThrow("Authentication required");});
it("denies foreign channel join/replay, sends and agent requests",async()=>{
 const owner=account(),outsider=account(),workspace=createWorkspace(owner.user,{name:"Protected"}),s=await socket(outsider.token);
 const join=await s.timeout(5000).emitWithAck("room:join",{roomId:workspace.channelId,lastSeq:0});expect(join).toHaveProperty("error");expect(join).not.toHaveProperty("state");
 expect(await s.timeout(5000).emitWithAck("message:send",{clientId:randomUUID(),content:"Intrusion"})).toHaveProperty("error");
 expect(await s.timeout(5000).emitWithAck("agent:request",{idempotencyKey:randomUUID(),prompt:"Intrusion"})).toHaveProperty("error");
 expect(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE room_id=?").get(workspace.channelId)).toEqual({n:0});expect(db.prepare("SELECT COUNT(*) AS n FROM agent_jobs WHERE room_id=?").get(workspace.channelId)).toEqual({n:0});
});
it("persists/replays signed-in messages and immediately evicts removed members",async()=>{
 const owner=account(),member=account(),w=createWorkspace(owner.user,{name:"Collaboration"});const invitation=createInvitation(owner.user,w.id,{});acceptInvitation(member.user,invitation.path.split("/").at(-1)!);
 const a=await socket(owner.token),b=await socket(member.token);
 for(const s of [a,b])expect(await s.timeout(5000).emitWithAck("room:join",{roomId:w.channelId,lastSeq:0})).toHaveProperty("state");
 const received=new Promise<Record<string,unknown>>(resolve=>b.once("room:event",resolve));
 const result=await a.timeout(5000).emitWithAck("message:send",{clientId:randomUUID(),content:"Persistent"});expect(result.ok).toBe(true);expect((await received).type).toBe("message");
 const replay=await b.timeout(5000).emitWithAck("room:join",{roomId:w.channelId,lastSeq:0});expect(replay.state.messages).toHaveLength(1);expect(replay.state.replay).toHaveLength(1);
 const disconnected=new Promise<void>(resolve=>b.once("disconnect",()=>resolve()));changeMember(owner.user,w.id,member.user);await disconnected;expect(b.connected).toBe(false);
});
it("disconnects an idle socket when its persisted session is revoked",async()=>{
 const accountA=account(),s=await socket(accountA.token),disconnected=new Promise<void>(resolve=>s.once("disconnect",()=>resolve()));
 db.prepare("DELETE FROM session WHERE sessionToken=?").run(accountA.token);await disconnected;expect(s.connected).toBe(false);
});
