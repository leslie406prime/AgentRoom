import type { Pool } from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const migrations=[{version:1,file:"001_initial.sql"}];
export async function migratePostgres(pool:Pool){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");await client.query("SET LOCAL statement_timeout = '15s'");await client.query("SELECT pg_advisory_xact_lock(714003921)");
    const exists=await client.query("SELECT to_regclass('public.postgres_migrations') AS name");
    if(!exists.rows[0].name){
      const tables=await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
      if(tables.rowCount)throw new Error("Refusing to initialize an unrecognized non-empty PostgreSQL database. Use a fresh empty database.");
      await client.query("CREATE TABLE postgres_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    }
    const applied=await client.query<{version:number;checksum:string}>("SELECT version,checksum FROM postgres_migrations ORDER BY version");
    if(applied.rows.some(row=>row.version>migrations.length))throw new Error("PostgreSQL schema is newer than this application.");
    for(const migration of migrations){
      const sql=await readFile(path.join(process.cwd(),"migrations/postgres",migration.file),"utf8"),checksum=createHash("sha256").update(sql).digest("hex");
      const old=applied.rows.find(row=>row.version===migration.version);
      if(old){if(old.checksum!==checksum)throw new Error("Applied PostgreSQL migration checksum changed.");continue;}
      await client.query(sql);await client.query("INSERT INTO postgres_migrations(version,checksum) VALUES ($1,$2)",[migration.version,checksum]);
    }
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}
