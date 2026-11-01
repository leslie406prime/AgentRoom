const path=require('node:path'),fs=require('node:fs'),net=require('node:net'),{randomBytes}=require('node:crypto'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
async function main(){
 const {default:EmbeddedPostgres}=await import('embedded-postgres');
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
 const id=randomBytes(8).toString('hex'),password=randomBytes(24).toString('hex');
 const directory=path.resolve('.tmp','postgres-tests',id);fs.mkdirSync(directory,{recursive:true});
 const postgres=new EmbeddedPostgres({databaseDir:directory,port,user:'postgres',password,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
 // embedded-postgres uses unchecked taskkill /F /T on Windows. It can wait
 // forever for an exit that never happens, and cannot prove a clean shutdown.
 // pg_ctl requests a checkpointed fast shutdown and reports failure/timeout.
 if(process.platform==='win32'){
  const {pg_ctl}=await import('@embedded-postgres/windows-x64');
  postgres.stop=async()=>{
   if(!fs.existsSync(path.join(directory,'postmaster.pid')))return;
   await promisify(execFile)(pg_ctl,['stop','-D',directory,'-m','fast','-w','-t','20'],{windowsHide:true,timeout:25000});
  };
 }
 const run=async(args,env)=>{
  const child=spawn(process.execPath,args,{env,stdio:'inherit',windowsHide:true,detached:process.platform!=='win32'});
  const budgetMs=process.argv.includes('--browser')?420000:120000;
  console.info('Waiting for isolated test child',child.pid,'with deadline',budgetMs/1000,'seconds.');
  let timer,timedOut=false;
  const code=await new Promise((resolve,reject)=>{
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.once('exit',code=>{clearTimeout(timer);resolve(code??1);});
   timer=setTimeout(()=>{
    timedOut=true;
    console.error('Isolated test child exceeded its deadline; terminating only its process tree:',child.pid);
    const cleanup=process.platform==='win32'
     ?promisify(execFile)('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:10000})
     :Promise.resolve().then(()=>process.kill(-child.pid,'SIGTERM'));
    cleanup.then(()=>reject(new Error('Isolated test child timed out.')),error=>reject(new Error('Isolated test timeout cleanup failed: '+error.message)));
   },budgetMs);
  }).finally(()=>clearTimeout(timer));
  if(timedOut)throw new Error('Isolated test child timed out.');
  if(code!==0)throw new Error('Test child failed with exit code '+code);
  console.info('Test child exited cleanly.');
 };
 try{
  console.info('Starting fresh local PostgreSQL test cluster (no cloud resources).');await postgres.initialise();await postgres.start();await postgres.createDatabase('agentroom_test');
  const env={...process.env,DATABASE_URL:`postgresql://postgres:${password}@127.0.0.1:${port}/agentroom_test`,DATABASE_PATH:':memory:',AGENTROOM_POSTGRES_TEST:'true',GEMINI_API_KEY:'',GROQ_API_KEY:'',OPENAI_API_KEY:'',AUTH_MOCK_OAUTH_ENABLED:'true',NODE_ENV:'test'};
  const args=process.argv.includes('--google-auth')?['tests/postgres/production-smoke.cjs','--google-auth']:process.argv.includes('--startup-diagnostics')?['tests/postgres/startup-failures.cjs']:process.argv.includes('--production')?['tests/postgres/production-smoke.cjs']:process.argv.includes('--browser')?['scripts/test-e2e.cjs','--mock-ai','tests/e2e/workspace-interactions.spec.ts']:[path.join(path.dirname(require.resolve('vitest/package.json')),'vitest.mjs'),'run','--config','vitest.postgres.config.ts'];
  await run(args,env);
  if(!process.argv.includes('--browser')&&!process.argv.includes('--production')&&!process.argv.includes('--startup-diagnostics')&&!process.argv.includes('--google-auth')){
   const restartEnv={...env,AGENTROOM_RESTART_FIXTURE:path.join(directory,'restart-fixture.json')};
   const restartArgs=[require.resolve('tsx/cli'),'tests/postgres/restart.ts'];
   await run([...restartArgs,'seed'],restartEnv);
   const counts=async()=>{const client=postgres.getPgClient('agentroom_test','127.0.0.1');await client.connect();try{return(await client.query('SELECT (SELECT count(*) FROM "user") AS users,(SELECT count(*) FROM messages) AS messages,(SELECT count(*) FROM artifacts) AS artifacts,(SELECT count(*) FROM agent_jobs) AS jobs')).rows[0]}finally{await client.end()}};
   const before=await counts();console.info('Restart snapshot captured; stopping PostgreSQL.');await postgres.stop();console.info('PostgreSQL stopped; restarting.');await postgres.start();const after=await counts();if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Restart persistence did not match');
   console.info('PostgreSQL engine restart persistence passed.');
   await run([...restartArgs,'verify'],restartEnv);
  }
  const observer=postgres.getPgClient('agentroom_test','127.0.0.1');
  await observer.connect();
  try{
   const {rows}=await observer.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()");
   if(rows[0].n!==0)throw new Error('Test clients remained connected after teardown.');
   console.info('No application PostgreSQL connections remain after teardown.');
  }finally{await observer.end();}
 }finally{await postgres.stop();console.info('Local PostgreSQL test cluster stopped; no data was imported.');}
}
main().catch(error=>{console.error('Local PostgreSQL test harness failed:',error.message??error.code??error.name);process.exitCode=1});
