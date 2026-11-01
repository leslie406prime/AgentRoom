import { randomUUID } from "node:crypto";
import { db,emitPersisted } from "./db";
import { PublicJobError } from "./job-errors";
const shared=process as typeof process & {__agentroomWorker?:string};
export const workerId=shared.__agentroomWorker??=randomUUID();
export const databaseNow="(EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint";
export const leaseDurationMs=90000;
const controllers=new Map<string,AbortController>();
export function jobSignal(jobId:string){return controllers.get(jobId)?.signal;}
export function abortWorkers(){for(const controller of controllers.values())controller.abort();}

export async function requireJobLease(jobId:string){
  if(db.kind!=="postgres")return;
  const row=await db.prepare("SELECT 1 FROM agent_jobs WHERE id=? AND status='running' AND worker_id=? AND lease_expires_at>"+databaseNow).get(jobId,workerId);
  if(!row)throw new PublicJobError("This request was interrupted or is owned by another worker. Submit a new request if needed.",false,"ACCESS_DENIED");
}
export function heartbeatJob(jobId:string){
  const controller=new AbortController();controllers.set(jobId,controller);
  if(db.kind!=="postgres")return()=>{controllers.delete(jobId);};
  let pending=false;
  const timer=setInterval(async()=>{
    if(pending)return;pending=true;
    try{const result=await db.prepare("UPDATE agent_jobs SET lease_expires_at="+databaseNow+"+? WHERE id=? AND status='running' AND worker_id=? AND lease_expires_at>"+databaseNow).run(leaseDurationMs,jobId,workerId);if(!result.changes)controller.abort();}
    catch{controller.abort();console.warn(JSON.stringify({level:"warn",event:"job_heartbeat_failed",jobId}));}
    finally{pending=false;}
  },10000);timer.unref();return()=>{clearInterval(timer);controllers.delete(jobId);};
}
// Called inside a short transaction. Never automatically repeat an uncertain external API call.
export async function expireJobLeases(roomId?:string){
  if(db.kind!=="postgres")return;
  const expired=await db.prepare("SELECT id,room_id FROM agent_jobs WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at<="+databaseNow+")"+(roomId?" AND room_id=?":"")+" FOR UPDATE").all(...(roomId?[roomId]:[]));
  for(const row of expired){
    const error="This request was interrupted when its worker stopped. Any provider usage may still count. Retry manually if needed.";
    await db.prepare("UPDATE agent_jobs SET status='failed',error=?,updated_at=? WHERE id=? AND status='running'").run(error,new Date().toISOString(),row.id);
    await db.prepare("UPDATE usage_records SET status='failed-estimated' WHERE job_id=? AND status='reserved'").run(row.id);
    const job=await db.prepare("SELECT id,requester_id AS requesterId,requester_name AS requesterName,prompt,status,error,agent,provider,model FROM agent_jobs WHERE id=?").get(row.id);
    await emitPersisted(String(row.room_id),"job",job);
  }
}
