const encoder=new TextEncoder();
export async function hash(value:string):Promise<string>{return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));}
function hex(v:Uint8Array){return Array.from(v,n=>n.toString(16).padStart(2,'0')).join('');}
async function key(secret:string){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function sign(payload:string,secret:string){return payload+'.'+hex(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(payload))));}
function cookieValue(request:Request,name:string){return (request.headers.get('cookie')??'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)??'';}
async function verified(value:string,secret:string){
 const pos=value.lastIndexOf('.'); if(pos<0||value.length>300)return null;
 const payload=value.slice(0,pos),signature=value.slice(pos+1);if(!/^[a-f0-9]{64}$/.test(signature))return null;
 const bytes=Uint8Array.from(signature.match(/../g)!,n=>parseInt(n,16));
 return await crypto.subtle.verify('HMAC',await key(secret),bytes,encoder.encode(payload))?payload:null;
}
function cookie(request:Request,name:string,value:string,maxAge:number){return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export async function getVisitor(request:Request,secret:string):Promise<{id:string;hash:string;setCookie?:string}>{
 const payload=await verified(cookieValue(request,'muse_visitor'),secret);const parts=payload?.split(':')??[];
 const now=Math.floor(Date.now()/1000);
 if(parts.length===2&&/^[a-f0-9-]{36}$/.test(parts[0])&&Number(parts[1])>now)return {id:parts[0],hash:await hash(parts[0])};
 const id=crypto.randomUUID();return {id,hash:await hash(id),setCookie:cookie(request,'muse_visitor',await sign(id+':'+(now+2592000),secret),2592000)};
}
export async function makeAdminCookie(request:Request,secret:string){return cookie(request,'muse_admin',await sign('admin:'+Math.floor(Date.now()/1000+28800)+':'+crypto.randomUUID(),secret),28800);}
export async function isAdmin(request:Request,secret:string){const p=(await verified(cookieValue(request,'muse_admin'),secret))?.split(':');return !!(p?.length===3&&p[0]==='admin'&&Number(p[1])>Date.now()/1000);}
export function clearAdminCookie(request:Request){return cookie(request,'muse_admin','',0);}
export async function sameSecret(a:string,b:string){const aa=await hash(a),bb=await hash(b);let diff=0;for(let i=0;i<aa.length;i++)diff|=aa.charCodeAt(i)^bb.charCodeAt(i);return diff===0;}
