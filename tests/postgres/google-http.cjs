const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
module.exports=async function verifyGoogle(origin,env){
 const pool=new Pool({connectionString:env.DATABASE_URL});
 const count=async()=>{const r=await pool.query('SELECT (SELECT COUNT(*) FROM "user") AS users,(SELECT COUNT(*) FROM account) AS accounts,(SELECT COUNT(*) FROM session) AS sessions');return r.rows[0];};
 function browser(){
  const jar=new Map();
  const request=async(route,options={})=>{const r=await fetch(origin+'/api/auth'+route,{...options,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{...options.headers,cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),origin:env.AUTH_URL}});for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],pos=pair.indexOf('=');if(/max-age=0/i.test(c))jar.delete(pair.slice(0,pos));else jar.set(pair.slice(0,pos),pair.slice(pos+1));}return r;};
  return {request,async login(identity){
   const csrf=await(await request('/csrf')).json();const begin=await request('/signin/google',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrfToken:csrf.csrfToken,callbackUrl:env.AUTH_URL+'/'}).toString()});
   const auth=new URL(begin.headers.get('location'));assert.equal(auth.hostname,'accounts.google.com','Google authorization did not begin');
   const code=Buffer.from(JSON.stringify({identity,nonce:auth.searchParams.get('nonce'),challenge:auth.searchParams.get('code_challenge')})).toString('base64url');
   const callback=await request('/callback/google?'+new URLSearchParams({code,state:auth.searchParams.get('state')}));
   return new URL(callback.headers.get('location'));
  },async session(){return(await request('/session')).json();}};
 }
 try{
  const first=browser(),profile={sub:randomUUID(),email:'production-oidc-fixture@example.test',name:'Google fixture',email_verified:true};
  const result=await first.login(profile);
  if(result.searchParams.has('error')){console.info('Production OIDC reproduction failed:',JSON.stringify({error:result.searchParams.get('error'),counts:await count()}));throw new Error('Production Google OIDC login failed.');}
  const id=(await first.session()).user.id;assert(id);assert.notEqual(id,profile.sub);
  const returning=browser();assert(!(await returning.login(profile)).searchParams.has('error'));assert.equal((await returning.session()).user.id,id);
  const other=browser(),second={...profile,sub:randomUUID(),email:'production-oidc-second@example.test'};assert(!(await other.login(second)).searchParams.has('error'));assert.notEqual((await other.session()).user.id,id);
  assert.equal((await first.login({...profile,sub:randomUUID(),email:'unlinked-fixture@example.test'})).searchParams.get('error'),'LinkRequired');
  assert.equal((await first.login(second)).searchParams.get('error'),'AccessDenied');assert.equal((await first.session()).user.id,id);
  const collision=browser();assert.equal((await collision.login({...profile,sub:randomUUID()})).searchParams.get('error'),'OAuthAccountNotLinked');
  assert.equal((await count()).users,'2');assert.equal((await count()).accounts,'2');
  console.info('Production Google OIDC: first/returning/separate accounts, stable IDs, session persistence and no email merging passed.');
 }finally{await pool.end();}
};
