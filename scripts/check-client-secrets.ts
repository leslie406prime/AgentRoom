import { loadEnvConfig } from "@next/env";
import fs from "node:fs";
import path from "node:path";
loadEnvConfig(process.cwd());
const names=["GEMINI_API_KEY","GROQ_API_KEY","AUTH_SECRET","AUTH_GOOGLE_SECRET","OPENAI_API_KEY","WORKSPACE_CREDENTIAL_KEY","DATABASE_URL","DIRECT_DATABASE_URL"];
const values=names.map(name=>({name,value:process.env[name]})).filter((item):item is {name:string;value:string}=>Boolean(item.value&&item.value.length>=8));
values.push({name:"mock client secret",value:"agentroom-mock-secret"});
const root=path.resolve(process.env.NEXT_DIST_DIR??".next","static");if(!fs.existsSync(root))throw new Error("Run npm run build first.");
let files=0;const leaks=new Set<string>();
function scan(folder:string){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const target=path.join(folder,entry.name);if(entry.isDirectory())scan(target);else{files++;const content=fs.readFileSync(target);for(const secret of values)if(content.includes(Buffer.from(secret.value)))leaks.add(secret.name);}}}
scan(root);if(leaks.size)throw new Error("Server secret found in client output: "+[...leaks].join(", "));
console.info(JSON.stringify({event:"client_secret_scan_passed",files,secretsChecked:values.map(s=>s.name)}));
