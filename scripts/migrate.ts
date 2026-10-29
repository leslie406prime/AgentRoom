import "../src/server/environment";
import { db } from "../src/server/db";
import { LATEST_SCHEMA_VERSION } from "../src/server/migrations";
const versions=db.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
console.info(JSON.stringify({event:"database_ready",schemaVersion:LATEST_SCHEMA_VERSION,migrations:versions}));
db.close();
