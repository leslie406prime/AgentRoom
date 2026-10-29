import type { NextConfig } from "next";
const origin=new URL(process.env.AUTH_URL??"http://localhost:"+(process.env.PORT??"3000"));
const socketOrigin=new URL(origin);socketOrigin.protocol=origin.protocol==="https:"?"wss:":"ws:";
const csp=["default-src 'self'","script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net","style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net","img-src 'self' data: blob: https:","font-src 'self' data: https://cdn.jsdelivr.net",`connect-src 'self' ${origin.origin} ${socketOrigin.origin} https://cdn.jsdelivr.net`,"worker-src 'self' blob: https://cdn.jsdelivr.net","object-src 'none'","base-uri 'self'","form-action 'self'","frame-ancestors 'none'","frame-src 'none'"].join("; ");
const nextConfig:NextConfig={
 distDir:process.env.NEXT_DIST_DIR??".next",logging:{incomingRequests:false},allowedDevOrigins:["127.0.0.1"],
 async headers(){return [
  {source:"/:path*",headers:[{key:"Content-Security-Policy",value:csp},{key:"X-Content-Type-Options",value:"nosniff"},{key:"Referrer-Policy",value:"no-referrer"},{key:"X-Frame-Options",value:"DENY"}]},
  {source:"/api/:path*",headers:[{key:"Cache-Control",value:"private, no-store"}]}
 ];}
};
export default nextConfig;
