// Test-only IPC bridge: exercise the real SIGTERM handler on Windows, where
// child.kill('SIGTERM') terminates a process without delivering a Node signal.
if(require('node:worker_threads').isMainThread){
 if(process.env.AGENTROOM_POSTGRES_TEST!=='true'||!process.send)throw new Error('Requires the local PostgreSQL smoke harness.');
 process.on('message',message=>{
  if(message==='shutdown'){
   if(process.listenerCount('SIGTERM'))process.emit('SIGTERM');
   else void Promise.resolve(process.__agentroomDatabase?.close()).finally(()=>process.disconnect());
  }
  if(message==='memory')process.send({rss:process.memoryUsage().rss});
 });
}
