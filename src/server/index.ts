import { ExchangeWorkspace } from './workspace';
import { createFundingCheckout, parseFundingWebhook } from './payments';
import { brands, scenarios } from '../shared/catalog';
import type { Auction, ScenarioId } from '../shared/types';
import { clearSessionCookie, issueSession, localDevelopment, matchesSecret, publisherIdentity, readSession, WORKSPACE_ID } from './auth';
export { ExchangeWorkspace };

const uuid = WORKSPACE_ID;
const json = (value:unknown,status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
/** Publisher-facing contract: no private campaign state, agent traces, or histories. */
function publisherAuction(auction:Auction) {
  const {id,scenario,publisher_id,intent,preferences,mode,payment_mode,status,created_at,updated_at,end_reason,error,winner,placement,current_round,max_rounds}=auction;
  return {id,scenario,publisher_id,intent,preferences,mode,payment_mode,status,created_at,updated_at,end_reason,error,winner,placement,current_round,max_rounds};
}

async function body(request:Request):Promise<Record<string,unknown>> {
  const raw=await request.text();
  if(raw.length>20000)throw new Error('Request is too large');
  const value=JSON.parse(raw||'{}');
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected a JSON object');
  return value;
}
export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    const url=new URL(request.url),path=url.pathname;
    if(!path.startsWith('/v1/')&&!path.startsWith('/api/'))return env.ASSETS.fetch(request);
    try {
      // Stripe verifies its own signed transport and signed workspace metadata.
      if(path==='/v1/stripe/webhook'&&request.method==='POST') {
        const event=await parseFundingWebhook(env.STRIPE_SECRET_KEY,env.STRIPE_WEBHOOK_SECRET,await request.text(),request.headers.get('stripe-signature')||'');
        if(event){if(!uuid.test(event.workspaceId))throw new Error('Invalid funding workspace');await env.EXCHANGE.getByName(event.workspaceId).fund(event);}
        return json({received:true});
      }
      const origin=request.headers.get('origin');
      if(request.method!=='GET'&&origin){
        const source=new URL(origin);
        const local=['localhost','127.0.0.1','[::1]'];
        if(source.origin!==url.origin&&!(local.includes(source.hostname)&&local.includes(url.hostname)))return json({error:'Cross-origin mutation is not allowed'},403);
      }
      const local=localDevelopment(request);
      const ownerWorkspace=uuid.test(env.OPERATOR_WORKSPACE_ID||'')?env.OPERATOR_WORKSPACE_ID:local?'00000000-0000-4000-8000-000000000001':undefined;
      const suppliedSession=await readSession(request,env.ADMIN_TOKEN);
      const session=suppliedSession?.workspace_id===ownerWorkspace?suppliedSession:null;
      const adminHeader=await matchesSecret(request.headers.get('x-admin-token'),env.ADMIN_TOKEN);
      const operatorAuth=local||adminHeader||!!session;
      if(path==='/api/session'){
        if(request.method==='GET')return json({authenticated:operatorAuth});
        if(request.method==='POST'){
          const input=await body(request);
          if(!await matchesSecret(input.token,env.ADMIN_TOKEN))return json({error:'Authentication required'},401);
          if(!ownerWorkspace)return json({error:'Operator workspace is not configured'},503);
          const issued=await issueSession(request,env.ADMIN_TOKEN,ownerWorkspace);
          const response=json({authenticated:true});response.headers.set('Set-Cookie',issued.cookie);return response;
        }
        if(request.method==='DELETE'){
          const response=json({authenticated:false});response.headers.set('Set-Cookie',clearSessionCookie(request));return response;
        }
        return json({error:'Method not allowed'},405);
      }
      const publisher=await publisherIdentity(request,env);
      const publisherAuth=!!publisher;
      const ownsPublisher=(publisherId:string)=>operatorAuth||publisher==='*'||publisher===publisherId;
      if(!operatorAuth&&!publisherAuth)return json({error:'Authentication required'},401);
      // Unsigned accord_workspace cookies are intentionally ignored. An operator
      // session selects only the UUID covered by its HMAC signature.
      let workspaceId=operatorAuth?ownerWorkspace:undefined;
      const requestedWorkspace=request.headers.get('x-workspace-id');
      // These three configured reference publishers belong to the shared integration
      // workspace, never the founder's private operator workspace.
      if(publisherAuth&&publisher!=='*'&&(!uuid.test(env.DEMO_WORKSPACE_ID||'')||requestedWorkspace!==env.DEMO_WORKSPACE_ID))return json({error:'Publisher workspace is not authorized'},403);
      if(publisherAuth&&requestedWorkspace&&uuid.test(requestedWorkspace))workspaceId=requestedWorkspace;
      const requestedStage=request.headers.get('x-demo-workspace');
      if(requestedStage&&requestedStage===env.DEMO_WORKSPACE_ID&&(operatorAuth||publisherAuth))workspaceId=requestedStage;
      if(!workspaceId)return json({error:publisherAuth?'Publisher workspace required':'Operator workspace is not configured'},publisherAuth?400:503);
      const workspace=env.EXCHANGE.getByName(workspaceId);
      const reply=json;
      const visibleAuction=(auction:Auction)=>operatorAuth?auction:publisherAuction(auction);
      if(request.method==='GET') {
        if(path==='/api/bootstrap'){
          const data=await workspace.bootstrap();
          const consumers=local?{dating:'http://localhost:8788',fashion:'http://localhost:8789',outings:'http://localhost:8790'}:{dating:'https://accord-dating-demo.kairosity-main-website.workers.dev',fashion:'https://accord-shopping-demo.kairosity-main-website.workers.dev',outings:'https://accord-outings-demo.kairosity-main-website.workers.dev'};
          const visible=operatorAuth?data:{...data,campaigns:[],ledger:[],scenarios:data.scenarios.filter(s=>ownsPublisher(s.publisher_id)),auctions:data.auctions.filter(a=>ownsPublisher(a.publisher_id)).map(publisherAuction)};
          return reply({...visible,presentation:env.DEMO_WORKSPACE_ID?{workspace_id:env.DEMO_WORKSPACE_ID,consumers}:undefined});
        }
        if(path==='/v1/auctions')return reply((await workspace.listAuctions()).filter(a=>ownsPublisher(a.publisher_id)).map(visibleAuction));
        if(path==='/v1/ledger'){if(!operatorAuth)return reply({error:'Authentication required'},401);return reply(await workspace.ledger());}
        const match=path.match(/^\/v1\/auctions\/([a-f0-9-]+)$/i);
        if(match){const auction=await workspace.readAuction(match[1]);if(!ownsPublisher(auction.publisher_id))return reply({error:'Auction not found'},404);return reply(visibleAuction(auction));}
      }
      if(request.method==='POST') {
        const match=path.match(/^\/api\/demo\/(dating|fashion|outings)\/auctions$/);
        if(match||path==='/v1/auctions') {
          const input=await body(request);
          const scenario=(match?.[1]||input.scenario) as ScenarioId;
          const template=scenarios.find(s=>s.id===scenario);
          if(!template)throw new Error('Choose dating, fashion, or outings');
          if(publisherAuth&&publisher!=='*'&&publisher!==template.publisher_id)return reply({error:'Publisher does not match the scenario adapter'},403);
          if(!match&&!publisherAuth) return reply({error:'Publisher API authentication required'},401);
          if(input.publisher_id&&input.publisher_id!==template.publisher_id)throw new Error('Publisher does not match the scenario adapter');
          if(typeof input.intent!=='string'||!input.intent.trim()||input.intent.length>2000)throw new Error('Intent must contain 1–2,000 characters');
          const preferences=input.preferences??template.preferences;
          if(!Array.isArray(preferences)||preferences.length>20||preferences.some(v=>typeof v!=='string'||v.length>500))throw new Error('Preferences must be a short list of text');
          if(input.mode!==undefined&&!['live','simulation'].includes(String(input.mode)))throw new Error('Invalid agent mode');
          if(input.payment_mode!==undefined&&!['sandbox','simulation'].includes(String(input.payment_mode)))throw new Error('Invalid payment mode');
          const target=Number(input.target_score??85),max=Number(input.max_rounds??5);
          if(!Number.isFinite(target)||target<0||target>100||!Number.isInteger(max)||max<1||max>5)throw new Error('Use a target from 0–100 and 1–5 rounds');
          return reply(visibleAuction(await workspace.start({scenario,intent:input.intent.trim(),preferences,mode:input.mode==='simulation'?'simulation':'live',target_score:target,max_rounds:max,payment_mode:input.payment_mode as 'sandbox'|'simulation'|undefined,request_path:path})),201);
        }
        const action=path.match(/^\/v1\/auctions\/([a-f0-9-]+)\/actions$/i);
        if(action){const auction=await workspace.readAuction(action[1]);if(!ownsPublisher(auction.publisher_id))return reply({error:'Auction not found'},404);return reply(visibleAuction(await workspace.action(action[1],String((await body(request)).action))));}
        const click=path.match(/^\/v1\/placements\/([a-f0-9-]+)\/click$/i);
        if(click){if(!operatorAuth){const auction=(await workspace.listAuctions()).find(a=>a.placement?.id===click[1]);if(!auction||!ownsPublisher(auction.publisher_id))return reply({error:'Placement not found'},404);}return reply(await workspace.click(click[1]));}
        const funding=path.match(/^\/v1\/campaigns\/([a-z0-9-]+)\/fund$/);
        if(funding){
          if(!operatorAuth)return reply({error:'Authentication required'},401);
          if(!brands.some(b=>b.id===funding[1]))throw new Error('Unknown brand');
          return reply(await createFundingCheckout(env.STRIPE_SECRET_KEY,{brandId:funding[1],amountCents:Number((await body(request)).amount_cents??10000),origin:url.origin,workspaceId}));
        }
        const simulation=path.match(/^\/api\/simulation\/fund\/([a-z0-9-]+)$/);
        if(simulation){if(!operatorAuth)return reply({error:'Authentication required'},401);return reply(await workspace.simulationFund(simulation[1],Number((await body(request)).amount_cents??10000)));}
      }
      if(request.method==='PATCH'){
        const campaign=path.match(/^\/v1\/campaigns\/([a-z0-9-]+)$/);
        if(campaign){if(!operatorAuth)return reply({error:'Authentication required'},401);return reply(await workspace.updateCampaign(campaign[1],await body(request)));}
      }
      return reply({error:'API route not found'},404);
    }catch(error){return json({error:error instanceof Error?error.message:'Exchange request failed'},400);}
  },
} satisfies ExportedHandler<Env>;
