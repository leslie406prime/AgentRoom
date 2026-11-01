import "../src/server/environment";
import {db,initializeDatabase} from "../src/server/db";
async function main(){
 if(db.kind!=="postgres")throw new Error("DATABASE_URL is required; this command never migrates or imports SQLite.");
 try{await initializeDatabase();console.info(JSON.stringify({event:"postgres_schema_ready"}));}finally{await db.close();}
}
void main().catch(()=>{console.error(JSON.stringify({event:"postgres_migration_failed"}));process.exitCode=1;});
