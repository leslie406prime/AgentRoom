const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),net=require('node:net'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{pathToFileURL}=require('node:url');
const root=process.cwd();
const url=new URL(process.env.DATABASE_URL??'http://invalid');
assert(process.env.AGENTROOM_POSTGRES_TEST==='true'&&url.hostname==='127.0.0.1'&&url.pathname==='/agentroom_test');
const env={...process.env,NODE_ENV:'production',NEXT_DIST_DIR:'.next-verify',AUTH_URL:'https://agentroom-m6aa.onrender.com',AUTH_SECRET:'isolated-startup-check-secret-123456789',AUTH_MOCK_OAUTH_ENABLED:'false',AGENTROOM_BUILD_ONLY:'',AGENTROOM_E2E_SERVER_MANAGED:'',DATABASE_PATH:':memory:',GEMINI_API_KEY:'',GROQ_API_KEY:'',OPENAI_API_KEY:'',PORT:'0'};
async function failure(label,overrides,stage,code,cwd=root){
 const child=spawn(process.execPath,['--import',pathToFileURL(require.resolve('tsx')).href,'--import',pathToFileURL(path.join(root,'src/server/environment.ts')).href,path.join(root,'server.ts')],{cwd,env:{...env,...overrides},stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:45000});
 let stdout='',stderr='';child.stdout.on('data',b=>{stdout=(stdout+String(b)).slice(-65536);});child.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-65536);});
 const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 assert(!child.killed,label+': process timed out instead of exiting cleanly');assert.equal(result.code,1,label+': expected failure exit code');
 const records=stderr.split(/\r?\n/).flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}}).filter(row=>row.event==='server_startup_failed');
 assert.equal(records.length,1,label+': expected one safe diagnostic');assert.equal(records[0].stage,stage,label+': incorrect stage');assert.equal(records[0].code,code,label+': incorrect error code');
 const output=stdout+stderr;
 for(const secret of [env.DATABASE_URL,new URL(env.DATABASE_URL).password,env.AUTH_SECRET,'startup-rejected-password','configuration-credential-canary'])assert(!output.includes(secret),label+': sensitive value appeared in output');
 if(code==='28P01')assert.equal(records[0].sqlstate,'28P01');
 console.info('Startup diagnostic passed:',label,JSON.stringify({stage:records[0].stage,code:records[0].code,sqlstate:records[0].sqlstate}));
}
async function main(){
 const rejected=new URL(env.DATABASE_URL);rejected.password='startup-rejected-password';
 await failure('database authentication',{DATABASE_URL:rejected.toString()},'database_connection','28P01');
 await failure('invalid configuration',{AUTH_URL:'configuration-credential-canary'},'configuration','ERR_INVALID_URL');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'agentroom-startup-check-'));
 try{await failure('missing migration resource',{},'migration','ENOENT',folder);}finally{
  if(path.dirname(folder)!==path.resolve(os.tmpdir())||!path.basename(folder).startsWith('agentroom-startup-check-'))throw new Error('Unexpected fixture path');fs.rmSync(folder,{recursive:true,force:true});
 }
 const blocker=net.createServer();await new Promise((resolve,reject)=>{blocker.once('error',reject);blocker.listen(0,'0.0.0.0',resolve);});
 try{await failure('occupied port',{PORT:String(blocker.address().port)},'port_binding','EADDRINUSE');}finally{await new Promise(resolve=>blocker.close(resolve));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
