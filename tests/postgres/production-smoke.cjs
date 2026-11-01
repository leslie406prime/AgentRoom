const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),net=require('node:net');
const {io}=require('socket.io-client');
async function main(){
 const url=new URL(process.env.DATABASE_URL??'http://invalid');
 assert(process.env.AGENTROOM_POSTGRES_TEST==='true'&&url.hostname==='127.0.0.1'&&url.pathname==='/agentroom_test');
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
 const origin='http://127.0.0.1:'+port;
 const env={...process.env,NODE_ENV:'production',NEXT_DIST_DIR:'.next-verify',AUTH_URL:'https://agentroom-m6aa.onrender.com',AUTH_SECRET:'isolated-production-smoke-secret-123456789',AUTH_MOCK_OAUTH_ENABLED:'false',AGENTROOM_BUILD_ONLY:'',AGENTROOM_E2E_SERVER_MANAGED:'',DATABASE_PATH:':memory:',GEMINI_API_KEY:'',GROQ_API_KEY:'',OPENAI_API_KEY:'',PORT:String(port)};
 const child=spawn(process.execPath,['--import','tsx','--import','./src/server/environment.ts','--require','./tests/postgres/production-preload.cjs','server.ts'],{env,stdio:['ignore','inherit','inherit','ipc'],windowsHide:true});
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 try{
  let ready=false;const deadline=Date.now()+120000;
  while(Date.now()<deadline){
   assert(child.exitCode===null,'Production server exited before readiness');
   try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(3000)})).ok){ready=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert(ready,'Production health did not become ready');
  const response=await fetch(origin+'/sign-in');assert.equal(response.status,200);
  assert(response.headers.get('content-security-policy').includes('wss://agentroom-m6aa.onrender.com'));
  assert.deepEqual(Object.keys(await (await fetch(origin+'/api/auth/providers')).json()),['google']);
  const socket=io(origin,{transports:['websocket'],reconnection:false,timeout:10000});
  try{await new Promise((resolve,reject)=>{socket.once('connect',()=>reject(new Error('Anonymous socket was accepted')));socket.once('connect_error',error=>{try{assert.match(error.message,/Authentication required/);resolve();}catch(e){reject(e);}});});}finally{socket.disconnect();}
  const rss=await new Promise(resolve=>{child.once('message',message=>resolve(message.rss));child.send('memory');});
  console.info('Production HTTP, Google-only auth, build/runtime CSP, shared WebSocket port and anonymous socket rejection passed. Idle RSS MiB:',Math.round(rss/1048576));
 }finally{
  if(child.exitCode===null)child.send('shutdown');
  let timer;
  try{
   const result=await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Production shutdown timed out')),35000);})]);
   assert.equal(result.code,0,'Production shutdown failed');
   console.info('Production SIGTERM handler drained and closed cleanly.');
  }finally{clearTimeout(timer);}
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
