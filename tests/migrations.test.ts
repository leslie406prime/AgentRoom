import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect,it } from "vitest";
import { migrate,LATEST_SCHEMA_VERSION } from "../src/server/migrations";
it("backs up a legacy database and preserves every historical row and sequence",()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),"agentroom-migration-")),filename=path.join(folder,"fixture.sqlite");
 const db=new Database(filename);db.pragma("foreign_keys=ON");db.pragma("journal_mode=WAL");
 db.exec(fs.readFileSync(path.resolve("tests/fixtures/legacy.sql"),"utf8"));
 db.exec(`INSERT INTO rooms(id,name,next_seq) VALUES ('legacy-room-1234','Old project',9);
 INSERT INTO members(id,room_id,name,color) VALUES ('anonymous-123','legacy-room-1234','Legacy author','#ffffff');
 INSERT INTO room_events(room_id,seq,type,payload) VALUES ('legacy-room-1234',3,'message','{"content":"first"}'),('legacy-room-1234',9,'artifact','{}');
 INSERT INTO messages(id,room_id,author_id,author_name,content,kind,created_at,seq) VALUES ('message-one','legacy-room-1234','anonymous-123','Legacy author','first','human','2025-01-01',3),('message-two','legacy-room-1234','agent','Room agent','second','agent','2025-01-02',7);
 INSERT INTO agent_jobs(id,room_id,requester_id,requester_name,prompt,idempotency_key,status) VALUES ('job-old','legacy-room-1234','anonymous-123','Legacy author','help','key-old','queued');
 INSERT INTO agent_jobs(id,room_id,requester_id,requester_name,prompt,idempotency_key,status,created_at) VALUES ('job-earlier','legacy-room-1234','anonymous-123','Legacy author','earlier','key-earlier','queued','2024-01-01 00:00:00');
 INSERT INTO artifacts(id,room_id,title,type,language,content,version,updated_by,updated_at) VALUES ('artifact-old','legacy-room-1234','Notes','document','markdown','current',2,'Legacy author','2025-01-02');
 INSERT INTO artifact_versions(room_id,artifact_id,version,title,type,language,content,updated_by,updated_at) VALUES ('legacy-room-1234','artifact-old',1,'Notes','document','markdown','original','Legacy author','2025-01-01');`);
 const tables=["rooms","members","room_events","messages","agent_jobs","artifacts","artifact_versions"];
 const before=Object.fromEntries(tables.map(t=>[t,db.prepare("SELECT * FROM "+t+" ORDER BY rowid").all()]));
 migrate(db,filename);migrate(db,filename);
 for(const table of tables){const rows=db.prepare("SELECT * FROM "+table+" ORDER BY rowid").all() as Record<string,unknown>[];if(table==="members")for(const r of rows)delete r.user_id;if(table==="agent_jobs")for(const r of rows){delete r.model;delete r.enqueue_order;delete r.agent;delete r.provider;}if(table==="messages")for(const r of rows){delete r.ai_mode;delete r.ai_agent;delete r.ai_provider;delete r.ai_model;}expect(rows).toEqual(before[table]);}
 const mapping=db.prepare("SELECT l.old_room_id,c.id,c.name,w.unclaimed_legacy FROM legacy_room_links l JOIN channels c ON c.id=l.channel_id JOIN workspaces w ON w.id=c.workspace_id").get();
 expect(mapping).toEqual({old_room_id:"legacy-room-1234",id:"legacy-room-1234",name:"general",unclaimed_legacy:1});
 expect(db.prepare("SELECT COUNT(*) AS n FROM memberships").get()).toEqual({n:0});
 expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
 expect(db.prepare("SELECT id FROM agent_jobs ORDER BY enqueue_order").all()).toEqual([{id:"job-earlier"},{id:"job-old"}]);
 expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({version:LATEST_SCHEMA_VERSION});
 const backups=fs.readdirSync(folder).filter(f=>f.endsWith(".bak"));expect(backups).toHaveLength(1);
 const backup=new Database(path.join(folder,backups[0]),{readonly:true});expect(backup.prepare("PRAGMA integrity_check").get()).toEqual({integrity_check:"ok"});expect(backup.prepare("SELECT next_seq FROM rooms").get()).toEqual({next_seq:9});backup.close();db.close();
});

it("refuses newer schemas and rolls back a failed ordered migration",()=>{
 const future=new Database(":memory:");migrate(future,":memory:");future.prepare("INSERT INTO schema_migrations(version) VALUES (999)").run();expect(()=>migrate(future,":memory:")).toThrow("newer");future.close();
 const legacy=new Database(":memory:");legacy.exec(fs.readFileSync(path.resolve("tests/fixtures/legacy.sql"),"utf8"));legacy.exec("INSERT INTO rooms(id,name) VALUES ('preserved-legacy','Keep me');CREATE TABLE workspaces(id TEXT PRIMARY KEY);");expect(()=>migrate(legacy,":memory:")).toThrow();expect(legacy.prepare("SELECT name FROM rooms").get()).toEqual({name:"Keep me"});expect(legacy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user'").get()).toBeUndefined();legacy.close();
});
