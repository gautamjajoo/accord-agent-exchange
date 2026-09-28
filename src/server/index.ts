import { ExchangeWorkspace } from './workspace';
import { createFundingCheckout, parseFundingWebhook } from './payments';
import { brands, scenarios } from '../shared/catalog';
import recordedAuction from '../../examples/live-value-auction.json';
import type { ScenarioId } from '../shared/types';
export { ExchangeWorkspace };

const uuid = /^[a-f0-9-]{36}$/i;
const json = (value:unknown,status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
async function body(request:Request):Promise<Record<string,unknown>> {
  const raw=await request.text();
  if(raw.length>20000)throw new Error('Request is too large');
  const value=JSON.parse(raw||'{}');
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected a JSON object');
  return value;
}
function authorized(request:Request,env:Env):boolean {
  const host=new URL(request.url).hostname;
  return ['localhost','127.0.0.1'].includes(host)||!!env.ADMIN_TOKEN&&request.headers.get('x-admin-token')===env.ADMIN_TOKEN;
}
export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    const url=new URL(request.url),path=url.pathname;
    if(!path.startsWith('/v1/')&&!path.startsWith('/api/'))return env.ASSETS.fetch(request);
    let workspaceId=request.headers.get('cookie')?.match(/(?:^|;\s*)accord_workspace=([a-f0-9-]{36})(?:;|$)/i)?.[1];
    const newWorkspace=!workspaceId;
    workspaceId ||= crypto.randomUUID();
    const publisherAuth=!!env.PUBLISHER_API_KEY&&request.headers.get('authorization')===`Bearer ${env.PUBLISHER_API_KEY}`;
    if(publisherAuth&&uuid.test(request.headers.get('x-workspace-id')||''))workspaceId=request.headers.get('x-workspace-id')!;
    const requestedStage=request.headers.get('x-demo-workspace');
    if(requestedStage&&requestedStage===env.DEMO_WORKSPACE_ID)workspaceId=requestedStage;
    const workspace=env.EXCHANGE.getByName(workspaceId);
    const reply=(value:unknown,status=200) => {
      const response=json(value,status);
      if(newWorkspace)response.headers.set('Set-Cookie',`accord_workspace=${workspaceId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${url.protocol==='https:'?'; Secure':''}`);
      return response;
    };
    try {
      if(path==='/v1/stripe/webhook'&&request.method==='POST') {
        const event=await parseFundingWebhook(env.STRIPE_SECRET_KEY,env.STRIPE_WEBHOOK_SECRET,await request.text(),request.headers.get('stripe-signature')||'');
        if(event){if(!uuid.test(event.workspaceId))throw new Error('Invalid funding workspace');await env.EXCHANGE.getByName(event.workspaceId).fund(event);}
        return json({received:true});
      }
      const origin=request.headers.get('origin');
      if(request.method!=='GET'&&origin){
        const source=new URL(origin);
        const local=['localhost','127.0.0.1'];
        if(source.origin!==url.origin&&!(local.includes(source.hostname)&&local.includes(url.hostname)))return reply({error:'Cross-origin mutation is not allowed'},403);
      }
      if(request.method!=='GET'&&!authorized(request,env)&&!publisherAuth)return reply({error:'Enter the demo admin token in Connection settings to run agents or change campaigns.'},401);
      if(request.method==='GET') {
        if(path==='/api/bootstrap'){
          const data=await workspace.bootstrap();
          const local=['localhost','127.0.0.1'].includes(url.hostname);
          const consumers=local?{dating:'http://localhost:8788',fashion:'http://localhost:8789',outings:'http://localhost:8790'}:{dating:'https://accord-dating-demo.kairosity-main-website.workers.dev',fashion:'https://accord-shopping-demo.kairosity-main-website.workers.dev',outings:'https://accord-outings-demo.kairosity-main-website.workers.dev'};
          return reply({...data,presentation:env.DEMO_WORKSPACE_ID?{workspace_id:env.DEMO_WORKSPACE_ID,consumers}:undefined,auctions:[...data.auctions,{...recordedAuction.auction,id:`recorded:${recordedAuction.auction.id}`,placement:undefined}]});
        }
        if(path==='/v1/auctions')return reply(await workspace.listAuctions());
        if(path==='/v1/ledger')return reply(await workspace.ledger());
        const match=path.match(/^\/v1\/auctions\/([a-f0-9-]+)$/i);
        if(match)return reply(await workspace.readAuction(match[1]));
      }
      if(request.method==='POST') {
        const match=path.match(/^\/api\/demo\/(dating|fashion|outings)\/auctions$/);
        if(match||path==='/v1/auctions') {
          const input=await body(request);
          const scenario=(match?.[1]||input.scenario) as ScenarioId;
          const template=scenarios.find(s=>s.id===scenario);
          if(!template)throw new Error('Choose dating, fashion, or outings');
          if(!match&&!publisherAuth) return reply({error:'Publisher API authentication required'},401);
          if(input.publisher_id&&input.publisher_id!==template.publisher_id)throw new Error('Publisher does not match the scenario adapter');
          if(typeof input.intent!=='string'||!input.intent.trim()||input.intent.length>2000)throw new Error('Intent must contain 1–2,000 characters');
          const preferences=input.preferences??template.preferences;
          if(!Array.isArray(preferences)||preferences.length>20||preferences.some(v=>typeof v!=='string'||v.length>500))throw new Error('Preferences must be a short list of text');
          if(input.mode!==undefined&&!['live','simulation'].includes(String(input.mode)))throw new Error('Invalid agent mode');
          if(input.payment_mode!==undefined&&!['sandbox','simulation'].includes(String(input.payment_mode)))throw new Error('Invalid payment mode');
          const target=Number(input.target_score??85),max=Number(input.max_rounds??5);
          if(!Number.isFinite(target)||target<0||target>100||!Number.isInteger(max)||max<1||max>5)throw new Error('Use a target from 0–100 and 1–5 rounds');
          return reply(await workspace.start({scenario,intent:input.intent.trim(),preferences,mode:input.mode==='simulation'?'simulation':'live',target_score:target,max_rounds:max,payment_mode:input.payment_mode as 'sandbox'|'simulation'|undefined}),201);
        }
        const action=path.match(/^\/v1\/auctions\/([a-f0-9-]+)\/actions$/i);
        if(action)return reply(await workspace.action(action[1],String((await body(request)).action)));
        const click=path.match(/^\/v1\/placements\/([a-f0-9-]+)\/click$/i);
        if(click)return reply(await workspace.click(click[1]));
        const funding=path.match(/^\/v1\/campaigns\/([a-z0-9-]+)\/fund$/);
        if(funding){
          if(!brands.some(b=>b.id===funding[1]))throw new Error('Unknown brand');
          return reply(await createFundingCheckout(env.STRIPE_SECRET_KEY,{brandId:funding[1],amountCents:Number((await body(request)).amount_cents??10000),origin:url.origin,workspaceId}));
        }
        const simulation=path.match(/^\/api\/simulation\/fund\/([a-z0-9-]+)$/);
        if(simulation)return reply(await workspace.simulationFund(simulation[1],Number((await body(request)).amount_cents??10000)));
      }
      if(request.method==='PATCH'){
        const campaign=path.match(/^\/v1\/campaigns\/([a-z0-9-]+)$/);
        if(campaign){if(!authorized(request,env))return reply({error:'Admin token required'},401);return reply(await workspace.updateCampaign(campaign[1],await body(request)));}
      }
      return reply({error:'API route not found'},404);
    }catch(error){return reply({error:error instanceof Error?error.message:'Exchange request failed'},400);}
  },
} satisfies ExportedHandler<Env>;
