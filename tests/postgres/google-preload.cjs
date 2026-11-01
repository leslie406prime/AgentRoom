// Isolated test-only Google OIDC transport. Never imported by application code.
const crypto=require('node:crypto');
const url=new URL(process.env.DATABASE_URL??'http://invalid');
if(process.env.AGENTROOM_POSTGRES_TEST!=='true'||url.hostname!=='127.0.0.1'||url.pathname!=='/agentroom_test'||process.env.AUTH_GOOGLE_ID!=='google-fixture-client')throw new Error('Google fixture requires isolated local PostgreSQL.');
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'},original=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(!['accounts.google.com','oauth2.googleapis.com','openidconnect.googleapis.com','www.googleapis.com'].includes(u.hostname))return original(input,init);
 if(u.pathname.endsWith('/.well-known/openid-configuration'))return Response.json({issuer:'https://accounts.google.com',authorization_endpoint:'https://accounts.google.com/o/oauth2/v2/auth',token_endpoint:'https://oauth2.googleapis.com/token',jwks_uri:'https://www.googleapis.com/oauth2/v3/certs',userinfo_endpoint:'https://openidconnect.googleapis.com/v1/userinfo',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256']});
 if(u.pathname.endsWith('/certs'))return Response.json({keys:[jwk]});
 if(u.hostname==='oauth2.googleapis.com'&&u.pathname==='/token'){
  const body=new URLSearchParams(String(init?.body)),fixture=JSON.parse(Buffer.from(body.get('code'),'base64url').toString());
  if(crypto.createHash('sha256').update(body.get('code_verifier')??'').digest('base64url')!==fixture.challenge)throw new Error('Fixture PKCE mismatch.');
  const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture'})).toString('base64url');
  const claims={...fixture.identity,nonce:fixture.nonce,iss:'https://accounts.google.com',aud:'google-fixture-client',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300};
  const data=header+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url'),jwt=data+'.'+crypto.sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');
  return Response.json({access_token:'fixture-access-token',token_type:'Bearer',expires_in:3600,id_token:jwt,scope:'openid email profile'});
 }
 throw new Error('Unexpected Google fixture endpoint.');
};
