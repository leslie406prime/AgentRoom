const {spawn,execFile}=require('node:child_process');
const path=require('node:path');
const net=require('node:net');
const {randomBytes}=require('node:crypto');
const live=process.argv[2]==='--live-ai';
const mockAI=process.argv[2]==='--mock-ai';
if(mockAI)process.argv.splice(2,1);
if(live){process.argv.splice(2,1);require('@next/env').loadEnvConfig(process.cwd(),true);if(!process.env.GEMINI_API_KEY?.trim()||!process.env.GROQ_API_KEY?.trim())throw new Error('Live application tests require GEMINI_API_KEY and GROQ_API_KEY in .env.local.');}
const testPort=live?'3101':'3000',testOrigin='http://localhost:'+testPort;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const env={...process.env,DATABASE_URL:'',NEXT_DIST_DIR:'.next-e2e',AUTH_MOCK_OAUTH_ENABLED:'true',AUTH_SECRET:'agentroom-playwright-test-secret',AUTH_URL:'http://localhost:3000',GEMINI_API_KEY:'',GROQ_API_KEY:'',OPENAI_API_KEY:'',OPENAI_MODEL:'gpt-4o-mini',WORKSPACE_CREDENTIAL_KEY:Buffer.alloc(32,7).toString('base64'),DATABASE_PATH:'./data/agentroom-e2e.sqlite',AVATAR_DIRECTORY:'./data/e2e-avatars',PORT:'3000',AGENTROOM_E2E_SERVER_MANAGED:'true',AGENTROOM_TEST_SHUTDOWN_TOKEN:randomBytes(32).toString('hex')};
if(live)Object.assign(env,{AUTH_URL:testOrigin,PORT:testPort,NEXT_DIST_DIR:'.next-live-e2e',DATABASE_PATH:'./data/agentroom-live-e2e-'+randomBytes(8).toString('hex')+'.sqlite',GEMINI_API_KEY:process.env.GEMINI_API_KEY,GROQ_API_KEY:process.env.GROQ_API_KEY});
if(mockAI)Object.assign(env,{AGENTROOM_MOCK_AI:'true',NODE_ENV:'development',NEXT_DIST_DIR:'.next-ui-e2e',DATABASE_PATH:'./data/agentroom-ui-e2e-'+randomBytes(8).toString('hex')+'.sqlite',GEMINI_API_KEY:'test-gemini-placeholder',GROQ_API_KEY:'test-groq-placeholder'});
if(process.env.AGENTROOM_POSTGRES_TEST==='true'){const url=new URL(process.env.DATABASE_URL);if(url.hostname!=='127.0.0.1'||url.pathname!=='/agentroom_test')throw new Error('Browser PostgreSQL tests require the local test database.');env.DATABASE_URL=process.env.DATABASE_URL;}
let server;
async function stop(){
 if(!server?.pid)return;
 const child=server,pid=child.pid;server=undefined;
 if(child.exitCode!==null)return;
 let graceful=false;
 try {const response=await fetch(env.AUTH_URL+'/__agentroom_test_shutdown',{method:'POST',headers:{origin:env.AUTH_URL,'x-agentroom-test-shutdown':env.AGENTROOM_TEST_SHUTDOWN_TOKEN},signal:AbortSignal.timeout(3000)});graceful=response.ok;}catch{}
 if(graceful){
  let timer;
  const exited=await new Promise(resolve=>{
   const done=()=>{clearTimeout(timer);resolve(true);};
   child.once('exit',done);
   timer=setTimeout(()=>{child.removeListener('exit',done);resolve(false);},35000);
   if(child.exitCode!==null)done();
  });
  graceful=exited&&child.exitCode===0;
 }
 if(!graceful){
  console.error('Test server did not shut down cleanly.');process.exitCode=1;
  if(process.platform==='win32')await new Promise(resolve=>execFile('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,timeout:10000},()=>resolve()));
  else try{process.kill(-pid,'SIGTERM');}catch{}
 }else console.info('Browser server drained workers and closed database clients cleanly.');
 child.stderr?.destroy();child.stdout?.destroy();
}
async function main(){
 await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(new Error('Port '+testPort+' is already in use. Stop that server before running isolated browser tests.')));probe.listen(Number(testPort),'127.0.0.1',()=>probe.close(resolve));});
 const npm=process.env.npm_execpath??path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 console.log('Starting isolated browser test server.');
 server=spawn(process.execPath,(mockAI?[require.resolve('tsx/cli'),'--import','./src/server/environment.ts','--import','./tests/e2e/mock-providers.ts','server.ts']:[npm,'run','dev']),{env,stdio:['ignore','ignore','pipe'],windowsHide:true,detached:process.platform!=='win32'});
 server.stderr.on('data',chunk=>{const text=String(chunk);if(!text.includes('NO_COLOR')&&!text.includes('trace-warnings'))process.stderr.write(text);});
 server.once('error',error=>{console.error(error.message);});
 const deadline=Date.now()+(process.env.AGENTROOM_POSTGRES_TEST==='true'?60000:180000);let ready=false;
 while(Date.now()<deadline){if(server.exitCode!==null)throw new Error('Test server exited before becoming ready.');try{const response=await fetch(env.AUTH_URL+'/api/health',{signal:AbortSignal.timeout(3000)});if(response.ok){ready=true;break;}}catch{}await sleep(250);}
 if(!ready)throw new Error('Test server did not become ready.');
 console.info('Browser server ready; starting Playwright'+(process.env.AGENTROOM_POSTGRES_TEST==='true'?' with a 300-second global deadline.':'.'));
 const test=spawn(process.execPath,[require.resolve('@playwright/test/cli'),'test',...(process.env.AGENTROOM_POSTGRES_TEST==='true'?['--global-timeout=300000']:[]),...(live?['--config','playwright.live.config.ts']:[]),...process.argv.slice(2)],{env,stdio:'inherit',windowsHide:true});
 process.exitCode=await new Promise((resolve,reject)=>{test.once('error',reject);test.once('exit',code=>resolve(code??1));});
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(stop);
process.once('SIGINT',()=>{process.exitCode=130;void stop();});
process.once('SIGTERM',()=>{process.exitCode=143;void stop();});
