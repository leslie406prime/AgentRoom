import { AsyncLocalStorage } from "node:async_hooks";
import Database from "better-sqlite3";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import fs from "node:fs";
import path from "node:path";
import { migrate } from "./migrations";
// Use pg's maintained CommonJS entry point in the custom Node/Next server.
// Its ESM external creates an async webpack module boundary in Next 15 route chunks.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pg=require("pg") as typeof import("pg");
const {types}=pg;

export type Row = Record<string, unknown>;
// Channel counters and epoch milliseconds must remain safe JavaScript numbers.
types.setTypeParser(20, value => { const n=Number(value);if(!Number.isSafeInteger(n))throw new Error("Database integer exceeds the supported range.");return n; });
types.setTypeParser(1700,value=>{const n=Number(value);if(!Number.isFinite(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER)throw new Error("Database numeric value exceeds the supported range.");return n;});

export function postgresSQL(sql: string) {
  let out="", index=0;
  // Skip quoted literals/identifiers. Quote legacy camelCase names/aliases and bind values separately.
  const tokens=sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_][A-Za-z_0-9]*|\?|[^A-Za-z_'"?]+/g) ?? [];
  for(const token of tokens) out+=token==="?" ? "$"+(++index) : /^[A-Za-z_][A-Za-z_0-9]*$/.test(token)&&/[A-Z]/.test(token)&&/[a-z]/.test(token) ? '"'+token+'"' : token;
  if(/^\s*INSERT OR IGNORE\b/i.test(out)) out=out.replace(/INSERT OR IGNORE/i,"INSERT")+" ON CONFLICT DO NOTHING";
  return out;
}

type Context={ client?: PoolClient; active: boolean };
export class DatabaseAccess {
  readonly context=new AsyncLocalStorage<Context>();
  private tail:Promise<unknown>=Promise.resolve();
  readonly sqlite?: Database.Database;
  readonly pool?: Pool;
  readonly kind:"sqlite"|"postgres";
  constructor() {
    const build=process.env.AGENTROOM_BUILD_ONLY==="true";
    if(process.env.DATABASE_URL&&!build){
      const url=new URL(process.env.DATABASE_URL);
      if(!["postgres:","postgresql:"].includes(url.protocol))throw new Error("DATABASE_URL must be a PostgreSQL URL.");
      const local=["127.0.0.1","localhost","[::1]"].includes(url.hostname);
      if(!local && url.searchParams.get("sslmode")==="disable")throw new Error("Remote PostgreSQL requires TLS.");
      // Do not allow URL parameters to replace certificate verification silently.
      for(const parameter of ["ssl","sslmode","sslcert","sslkey","sslrootcert","uselibpqcompat"])url.searchParams.delete(parameter);
      // query_timeout is client-side. Session startup parameters such as
      // statement_timeout are not portable through Neon's transaction pooler.
      this.pool=new pg.Pool({connectionString:url.toString(),max:3,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,query_timeout:20000,...(!local?{ssl:{rejectUnauthorized:true}}:{})});
      this.pool.on("error",()=>console.error(JSON.stringify({level:"error",event:"database_pool_error"})));
      this.kind="postgres";
    }else{
      if(process.env.NODE_ENV==="production"&&!build)throw new Error("Production requires DATABASE_URL; SQLite fallback is disabled.");
      const filename=build?":memory:":process.env.DATABASE_PATH??"./data/agentroom.sqlite";
      if(filename!==":memory:")fs.mkdirSync(path.dirname(path.resolve(filename)),{recursive:true});
      this.sqlite=new Database(filename);this.sqlite.pragma("journal_mode=WAL");this.sqlite.pragma("foreign_keys=ON");this.sqlite.pragma("busy_timeout=5000");migrate(this.sqlite,filename);
      this.kind="sqlite";
    }
  }
  private async exclusive<T>(fn:()=>Promise<T>|T):Promise<T>{
    const old=this.tail;let release!:()=>void;this.tail=new Promise<void>(resolve=>{release=resolve});await old;
    try{return await fn()}finally{release()}
  }
  private current(){const c=this.context.getStore();if(c&&!c.active)throw new Error("Transaction scope has ended.");return c;}
  async query(sql:string,params:unknown[]=[]):Promise<Row[]> {
    const c=this.current();
    if(this.pool)return (await (c?.client??this.pool).query<QueryResultRow>(postgresSQL(sql),params)).rows;
    const execute=()=>this.sqlite!.prepare(sql).all(...params) as Row[];
    return c?execute():(await this.exclusive(execute));
  }
  prepare(sql:string){return {
    get:async(...params:unknown[])=> (await this.query(sql,params))[0],
    all:async(...params:unknown[])=>(await this.query(sql,params)),
    run:async(...params:unknown[])=>{
      const c=this.current();
      if(this.pool){const r=await(c?.client??this.pool).query(postgresSQL(sql),params);return{changes:r.rowCount??0};}
      const execute=()=>{const r=this.sqlite!.prepare(sql).run(...params);return{changes:r.changes};};
      return c?execute():(await this.exclusive(execute));
    },
  }}
  transaction<T>(fn:()=>Promise<T>|T){return {immediate:async():Promise<T>=>{
    if(this.current())return fn();
    const execute=async()=>{
      const client=this.pool?await this.pool.connect():undefined;
      const c:Context={client,active:true};
      try{
        if(client){await client.query("BEGIN");
          await client.query("SET LOCAL statement_timeout = '15s'");
          // Portfolio scale: short write transactions serialize across overlapping workers.
          // This transaction-scoped lock is compatible with Neon's transaction pooler.
          await client.query("SELECT pg_advisory_xact_lock(714003921)");
        }else this.sqlite!.exec("BEGIN IMMEDIATE");
        const result=await this.context.run(c,fn);
        if(client)await client.query("COMMIT");else this.sqlite!.exec("COMMIT");
        return result;
      }catch(error){if(client)await client.query("ROLLBACK").catch(()=>{});else this.sqlite!.exec("ROLLBACK");throw error;}
      finally{c.active=false;client?.release();}
    };
    return this.pool?(await execute()):(await this.exclusive(execute));
  }}}
  async close(){if(this.pool)await this.pool.end();else this.sqlite?.close();}
}

const shared=process as typeof process & {__agentroomDatabase?: DatabaseAccess};
export const database=shared.__agentroomDatabase??=new DatabaseAccess();
