/** Founder/operator authentication; not a multi-tenant account or OAuth system. */
export const SESSION_COOKIE='accord_session';
export const SESSION_TTL_MS=8*60*60*1000;
export const WORKSPACE_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export interface OperatorSession {workspace_id:string;expires_at:number}
const encoder=new TextEncoder();
export function localDevelopment(request:Request):boolean{return ['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);}
function encoded(bytes:Uint8Array):string{return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function decoded(value:string):Uint8Array {if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('Invalid encoding');return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}
async function key(secret:string){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
/** Compare fixed-size hashes, without an input-dependent character comparison. */
export async function matchesSecret(candidate:unknown,secret:string|undefined):Promise<boolean>{
  if(typeof candidate!=='string'||!secret||candidate.length>4096)return false;
  const [provided,expected]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(candidate)),crypto.subtle.digest('SHA-256',encoder.encode(secret))]);
  const a=new Uint8Array(provided),b=new Uint8Array(expected);let difference=0;
  for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
  return difference===0;
}
export async function signSession(session:OperatorSession,secret:string):Promise<string>{
  if(!secret)throw new Error('Operator authentication is not configured');
  const payload=encoded(encoder.encode(JSON.stringify(session)));
  const signature=await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(`accord-session-v1.${payload}`));
  return `${payload}.${encoded(new Uint8Array(signature))}`;
}
export async function readSession(request:Request,secret:string|undefined,now=Date.now()):Promise<OperatorSession|null>{
  if(!secret)return null;
  const cookie=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length+1);
  if(!cookie||cookie.length>2048)return null;
  try{
    const parts=cookie.split('.');if(parts.length!==2)return null;
    const signature=new Uint8Array(decoded(parts[1]));if(signature.length!==32)return null;
    if(!await crypto.subtle.verify('HMAC',await key(secret),signature,encoder.encode(`accord-session-v1.${parts[0]}`)))return null;
    const value:unknown=JSON.parse(new TextDecoder().decode(decoded(parts[0])));
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const session=value as OperatorSession;
    if(Object.keys(value).length!==2||!WORKSPACE_ID.test(session.workspace_id)||!Number.isSafeInteger(session.expires_at)||session.expires_at<=now||session.expires_at>now+SESSION_TTL_MS+60000)return null;
    return session;
  }catch{return null;}
}
export async function issueSession(request:Request,secret:string,workspaceId:string=crypto.randomUUID(),now=Date.now()):Promise<{session:OperatorSession;cookie:string}>{
  const session={workspace_id:workspaceId,expires_at:now+SESSION_TTL_MS};
  const value=await signSession(session,secret);
  return {session,cookie:`${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${!localDevelopment(request)||new URL(request.url).protocol==='https:'?'; Secure':''}`};
}
export function clearSessionCookie(request:Request):string{return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${!localDevelopment(request)||new URL(request.url).protocol==='https:'?'; Secure':''}`;}

/** Named publisher keys are server credentials, never browser session tokens. */
export async function publisherIdentity(request:Request,env:{PUBLISHER_API_KEYS?:string;PUBLISHER_API_KEY?:string}):Promise<string|null>{
  const authorization=request.headers.get('authorization');
  if(!authorization?.startsWith('Bearer '))return null;
  const token=authorization.slice(7);
  if(env.PUBLISHER_API_KEYS){
    let map:unknown;try{map=JSON.parse(env.PUBLISHER_API_KEYS);}catch{return null;}
    if(!map||typeof map!=='object'||Array.isArray(map))return null;
    for(const id of ['wavelength','wardrobe','cityguide']){
      const value=(map as Record<string,unknown>)[id];
      if(typeof value==='string'&&await matchesSecret(token,value))return id;
    }
    return null; // Never fall back to the global key when a map is configured.
  }
  return localDevelopment(request)&&await matchesSecret(token,env.PUBLISHER_API_KEY)?'*':null;
}
