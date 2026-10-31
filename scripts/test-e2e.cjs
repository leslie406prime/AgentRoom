const {spawn,execFile}=require('node:child_process');
const path=require('node:path');
const net=require('node:net');
const {randomBytes}=require('node:crypto');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const env={...process.env,NEXT_DIST_DIR:'.next-e2e',AUTH_MOCK_OAUTH_ENABLED:'true',AUTH_SECRET:'agentroom-playwright-test-secret',AUTH_URL:'http://localhost:3000',GEMINI_API_KEY:'',GROQ_API_KEY:'',OPENAI_API_KEY:'',OPENAI_MODEL:'gpt-4o-mini',WORKSPACE_CREDENTIAL_KEY:Buffer.alloc(32,7).toString('base64'),DATABASE_PATH:'./data/agentroom-e2e.sqlite',AVATAR_DIRECTORY:'./data/e2e-avatars',PORT:'3000',AGENTROOM_E2E_SERVER_MANAGED:'true',AGENTROOM_TEST_SHUTDOWN_TOKEN:randomBytes(32).toString('hex')};
let server;
async function stop(){
 if(!server?.pid)return;
 const child=server,pid=child.pid;server=undefined;
 let graceful=false;
 try {const response=await fetch(env.AUTH_URL+'/__agentroom_test_shutdown',{method:'POST',headers:{origin:env.AUTH_URL,'x-agentroom-test-shutdown':env.AGENTROOM_TEST_SHUTDOWN_TOKEN},signal:AbortSignal.timeout(3000)});graceful=response.ok;}catch{}
 if(graceful)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(7000)]);
 if(!graceful && process.platform==='win32')await new Promise(resolve=>execFile('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,timeout:10000},error=>{if(error)console.error('Test server cleanup required fallback termination.');resolve();}));
 else if(!graceful)try{process.kill(-pid,'SIGTERM');}catch{}
 child.stderr?.destroy();child.stdout?.destroy();try{child.kill();}catch{}child.unref();
}
async function main(){
 await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(new Error('Port 3000 is already in use. Stop that server before running isolated browser tests.')));probe.listen(3000,()=>probe.close(resolve));});
 const npm=process.env.npm_execpath??path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 console.log('Starting isolated browser test server.');
 server=spawn(process.execPath,[npm,'run','dev'],{env,stdio:['ignore','ignore','pipe'],windowsHide:true,detached:process.platform!=='win32'});
 server.stderr.on('data',chunk=>{const text=String(chunk);if(!text.includes('NO_COLOR')&&!text.includes('trace-warnings'))process.stderr.write(text);});
 server.once('error',error=>{console.error(error.message);});
 const deadline=Date.now()+180000;let ready=false;
 while(Date.now()<deadline){if(server.exitCode!==null)throw new Error('Test server exited before becoming ready.');try{const response=await fetch(env.AUTH_URL+'/api/health',{signal:AbortSignal.timeout(3000)});if(response.ok){ready=true;break;}}catch{}await sleep(250);}
 if(!ready)throw new Error('Test server did not become ready.');
 const test=spawn(process.execPath,[require.resolve('@playwright/test/cli'),'test',...process.argv.slice(2)],{env,stdio:'inherit',windowsHide:true});
 process.exitCode=await new Promise((resolve,reject)=>{test.once('error',reject);test.once('exit',code=>resolve(code??1));});
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{await stop();process.exit(process.exitCode??0);});
process.once('SIGINT',()=>{process.exitCode=130;void stop();});
process.once('SIGTERM',()=>{process.exitCode=143;void stop();});
