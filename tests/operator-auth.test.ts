import {beforeEach,describe,expect,it,vi} from 'vitest';
import {issueSession,matchesSecret,readSession,signSession,SESSION_TTL_MS} from '../src/server/auth';
vi.mock('../src/server/workspace',()=>({ExchangeWorkspace:class{}}));
vi.mock('../src/server/payments',()=>({createFundingCheckout:vi.fn(),parseFundingWebhook:vi.fn()}));
import worker from '../src/server/index';
import {parseFundingWebhook} from '../src/server/payments';

const SECRET='founder-token-for-tests';
const STAGE='ef5d07d4-fc2a-41d9-b0bc-e1869dfb8e7c';
const OTHER='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OWNER='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
function setup(){
  const workspace={bootstrap:vi.fn(async()=>({auctions:[],ledger:[],campaigns:[],scenarios:[]})),ledger:vi.fn(async()=>[]),listAuctions:vi.fn(async()=>[]),readAuction:vi.fn(async()=>({})),updateCampaign:vi.fn(async()=>({})),start:vi.fn(async()=>({id:'created'})),action:vi.fn(async()=>({id:'changed'})),fund:vi.fn(async()=>({}))};
  const env={ADMIN_TOKEN:SECRET,OPERATOR_WORKSPACE_ID:OWNER,PUBLISHER_API_KEYS:JSON.stringify({wavelength:'publisher-key',wardrobe:'wardrobe-key',cityguide:'cityguide-key'}),PUBLISHER_API_KEY:'legacy-key',DEMO_WORKSPACE_ID:STAGE,EXCHANGE:{getByName:vi.fn((_id:string)=>workspace)},ASSETS:{fetch:vi.fn(async()=>new Response('app'))},STRIPE_SECRET_KEY:'test-secret',STRIPE_WEBHOOK_SECRET:'webhook-secret'};
  const send=(path:string,method='GET',data?:unknown,headers:Record<string,string>={},origin='https://accord.example')=>worker.fetch(new Request(origin+path,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})}),env as unknown as Env);
  const login=async()=>{const response=await send('/api/session','POST',{token:SECRET});return response.headers.get('set-cookie')!.split(';')[0];};
  return {workspace,env,send,login};
}
beforeEach(()=>vi.clearAllMocks());
describe('operator session cryptography',()=>{
  it('compares fixed-size hashes and rejects missing or wrong credentials',async()=>{
    expect(await matchesSecret(SECRET,SECRET)).toBe(true);expect(await matchesSecret('wrong',SECRET)).toBe(false);expect(await matchesSecret('',undefined)).toBe(false);expect(await matchesSecret(null,SECRET)).toBe(false);
  });
  it('signs an eight-hour session and rejects tampering, expiry, and key rotation',async()=>{
    const request=new Request('https://accord.example/api/session');const now=Date.now();
    const issued=await issueSession(request,SECRET,OTHER,now);
    const authenticated=new Request(request,{headers:{cookie:issued.cookie.split(';')[0]}});
    expect(await readSession(authenticated,SECRET,now)).toEqual({workspace_id:OTHER,expires_at:now+SESSION_TTL_MS});
    expect(await readSession(authenticated,SECRET,now+SESSION_TTL_MS)).toBeNull();
    expect(await readSession(authenticated,'rotated',now)).toBeNull();
    const tampered=issued.cookie.replace('accord_session=','accord_session=x');
    expect(await readSession(new Request(request,{headers:{cookie:tampered}}),SECRET,now)).toBeNull();
  });
  it('rejects malformed signed payloads and unsigned legacy cookies',async()=>{
    const signed=await signSession({workspace_id:'not-uuid',expires_at:Date.now()+10000},SECRET);
    expect(await readSession(new Request('https://a.example',{headers:{cookie:`accord_session=${signed}`}}),SECRET)).toBeNull();
    expect(await readSession(new Request('https://a.example',{headers:{cookie:`accord_workspace=${OTHER}`}}),SECRET)).toBeNull();
  });
});

describe('operator authentication boundary',()=>{
  it('exposes session status and assets without touching a private workspace',async()=>{
    const h=setup();expect(await(await h.send('/api/session')).json()).toEqual({authenticated:false});expect(await(await h.send('/')).text()).toBe('app');expect(h.env.EXCHANGE.getByName).not.toHaveBeenCalled();
  });
  it('rejects wrong login and returns no token or cookie',async()=>{
    const h=setup(),r=await h.send('/api/session','POST',{token:'wrong'});expect(r.status).toBe(401);expect(await r.json()).toEqual({error:'Authentication required'});expect(r.headers.get('set-cookie')).toBeNull();
  });
  it('issues a secure HttpOnly strict cookie and authenticates later private reads',async()=>{
    const h=setup(),r=await h.send('/api/session','POST',{token:SECRET});expect(await r.json()).toEqual({authenticated:true});const cookie=r.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');expect(cookie).toContain('Secure');expect(cookie).toContain('SameSite=Strict');expect(cookie).toContain('Max-Age=28800');expect(cookie).not.toContain(SECRET);
    expect(await(await h.send('/api/session','GET',undefined,{cookie})).json()).toEqual({authenticated:true});
    expect((await h.send('/api/bootstrap','GET',undefined,{cookie})).status).toBe(200);
  });
  it.each(['/api/bootstrap','/v1/auctions','/v1/ledger',`/v1/auctions/${OTHER}`])('requires auth for sensitive GET %s',async(path)=>{
    const h=setup();const r=await h.send(path,'GET',undefined,{cookie:`accord_workspace=${OTHER}`,'x-demo-workspace':STAGE});expect(r.status).toBe(401);expect(await r.json()).toEqual({error:'Authentication required'});expect(h.env.EXCHANGE.getByName).not.toHaveBeenCalled();
  });
  it('preserves the stable founder workspace across logins and refuses unsigned substitution',async()=>{
    const h=setup(),a=await h.login(),b=await h.login();
    await h.send('/v1/ledger','GET',undefined,{cookie:a});const first=h.env.EXCHANGE.getByName.mock.calls.at(-1)![0];
    await h.send('/v1/ledger','GET',undefined,{cookie:`${a}; accord_workspace=${OTHER}`,'x-workspace-id':OTHER});expect(h.env.EXCHANGE.getByName).toHaveBeenLastCalledWith(first);
    await h.send('/v1/ledger','GET',undefined,{cookie:b});const second=h.env.EXCHANGE.getByName.mock.calls.at(-1)![0];expect(second).toBe(first);expect(second).toBe(OWNER);expect(second).not.toBe(OTHER);
  });
  it('rejects expired or tampered sessions before accessing a workspace',async()=>{
    const h=setup();const expired=await signSession({workspace_id:OTHER,expires_at:Date.now()-1},SECRET);
    for(const cookie of [`accord_session=${expired}`,'accord_session=bad.signature'])expect((await h.send('/v1/ledger','GET',undefined,{cookie})).status).toBe(401);
    expect(h.env.EXCHANGE.getByName).not.toHaveBeenCalled();
  });
  it('allows explicit shared-stage access only after authentication',async()=>{
    const h=setup();expect((await h.send('/api/bootstrap','GET',undefined,{'x-demo-workspace':STAGE})).status).toBe(401);
    const cookie=await h.login();expect((await h.send('/api/bootstrap','GET',undefined,{cookie,'x-demo-workspace':STAGE})).status).toBe(200);expect(h.env.EXCHANGE.getByName).toHaveBeenLastCalledWith(STAGE);
    await h.send('/api/bootstrap','GET',undefined,{cookie,'x-demo-workspace':OTHER});expect(h.env.EXCHANGE.getByName).not.toHaveBeenLastCalledWith(OTHER);
  });
  it('preserves the authenticated publisher adapter and its explicit workspace',async()=>{
    const h=setup(),headers={authorization:'Bearer publisher-key','x-workspace-id':STAGE};
    expect((await h.send('/api/bootstrap','GET',undefined,headers)).status).toBe(200);expect(h.env.EXCHANGE.getByName).toHaveBeenLastCalledWith(STAGE);
    expect((await h.send('/v1/auctions','POST',{scenario:'dating',intent:'Coffee',mode:'simulation'},headers)).status).toBe(201);
    expect(h.workspace.start).toHaveBeenCalled();
    expect((await h.send('/v1/campaigns/sightglass','PATCH',{active:false},headers)).status).toBe(401);
  });
  it('rejects cross-publisher scenarios and the retired global key',async()=>{
    const h=setup();
    expect((await h.send('/v1/auctions','POST',{scenario:'fashion',intent:'Shoes',mode:'simulation'},{authorization:'Bearer publisher-key','x-workspace-id':STAGE})).status).toBe(403);
    expect((await h.send('/api/bootstrap','GET',undefined,{authorization:'Bearer legacy-key','x-workspace-id':STAGE})).status).toBe(401);
    expect(h.workspace.start).not.toHaveBeenCalled();
  });
  it('does not expose another publisher auction or allow its actions',async()=>{
    const h=setup();h.workspace.readAuction.mockResolvedValue({publisher_id:'wardrobe'});
    const headers={authorization:'Bearer publisher-key','x-workspace-id':STAGE};
    expect((await h.send(`/v1/auctions/${OTHER}`,'GET',undefined,headers)).status).toBe(404);
    expect((await h.send(`/v1/auctions/${OTHER}/actions`,'POST',{action:'cancel'},headers)).status).toBe(404);
  });
  it('rejects publisher attempts to select the private owner workspace',async()=>{
    const h=setup();
    expect((await h.send('/api/bootstrap','GET',undefined,{authorization:'Bearer publisher-key','x-workspace-id':OWNER})).status).toBe(403);
    expect((await h.send('/api/bootstrap','GET',undefined,{authorization:'Bearer publisher-key','x-workspace-id':OTHER,'x-demo-workspace':STAGE})).status).toBe(403);
    expect(h.env.EXCHANGE.getByName).not.toHaveBeenCalled();
  });
  it('projects every publisher auction response without nested campaign secrets or execution traces',async()=>{
    const h=setup();
    const auction={id:OTHER,scenario:'dating',publisher_id:'wavelength',intent:'Coffee',preferences:[],mode:'live',status:'running',current_round:2,max_rounds:5,
      bidders:[{campaign:{max_cpc_cents:98765,max_discount_cents:12345,strategy:'PRIVATE_STRATEGY',balance_cents:87654}}],
      trace:[{payload:{private:'PRIVATE_TRACE'}}],rounds:[{actions:{explanation:'PRIVATE_HISTORY'}}],events:[{message:'PRIVATE_EVENT'}]};
    h.workspace.bootstrap.mockResolvedValue({auctions:[auction],ledger:[{private:'PRIVATE_LEDGER'}],campaigns:[{private:'PRIVATE_CAMPAIGN'}],scenarios:[{publisher_id:'wavelength'}]} as never);
    h.workspace.listAuctions.mockResolvedValue([auction] as never);
    h.workspace.readAuction.mockResolvedValue(auction);
    h.workspace.start.mockResolvedValue(auction);
    h.workspace.action.mockResolvedValue(auction);
    const headers={authorization:'Bearer publisher-key','x-workspace-id':STAGE};
    const requests=[
      h.send('/api/bootstrap','GET',undefined,headers),h.send('/v1/auctions','GET',undefined,headers),
      h.send(`/v1/auctions/${OTHER}`,'GET',undefined,headers),
      h.send('/v1/auctions','POST',{scenario:'dating',intent:'Coffee',mode:'live'},headers),
      h.send(`/v1/auctions/${OTHER}/actions`,'POST',{action:'pause'},headers),
    ];
    for(const response of await Promise.all(requests)){
      expect(response.ok).toBe(true);const content=await response.text();
      expect(content).toContain('wavelength');expect(content).not.toMatch(/PRIVATE_|max_cpc_cents|max_discount_cents|balance_cents|\"bidders\"|\"trace\"|\"rounds\"|\"events\"/);
    }
    const owner=await h.send(`/v1/auctions/${OTHER}`,'GET',undefined,{'x-admin-token':SECRET,'x-demo-workspace':STAGE});
    expect(await owner.text()).toContain('PRIVATE_STRATEGY');
  });
  it('reserves financial ledgers and funding to the operator',async()=>{
    const h=setup();const headers={authorization:'Bearer publisher-key','x-workspace-id':STAGE};
    expect((await h.send('/v1/ledger','GET',undefined,headers)).status).toBe(401);
    expect((await h.send('/api/simulation/fund/sightglass','POST',{amount_cents:100},headers)).status).toBe(401);
  });
  it('requires a publisher workspace rather than minting an unowned anonymous workspace',async()=>{
    const h=setup();expect((await h.send('/api/bootstrap','GET',undefined,{authorization:'Bearer publisher-key'})).status).toBe(403);expect(h.env.EXCHANGE.getByName).not.toHaveBeenCalled();
  });
  it('lets the owner mutate campaigns using only the signed cookie',async()=>{
    const h=setup(),cookie=await h.login();expect((await h.send('/v1/campaigns/sightglass','PATCH',{active:false},{cookie})).status).toBe(200);expect(h.workspace.updateCampaign).toHaveBeenCalled();
  });
  it('clears the cookie on logout and rejects cross-origin login/logout mutations',async()=>{
    const h=setup();const r=await h.send('/api/session','DELETE');expect(await r.json()).toEqual({authenticated:false});expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    for(const method of ['POST','DELETE'])expect((await h.send('/api/session',method,method==='POST'?{token:SECRET}:undefined,{origin:'https://evil.example'})).status).toBe(403);
  });
  it('retains localhost development access without requiring a token',async()=>{
    const h=setup();expect(await(await h.send('/api/session','GET',undefined,{},'http://localhost:8787')).json()).toEqual({authenticated:true});expect((await h.send('/api/bootstrap','GET',undefined,{},'http://127.0.0.1:8787')).status).toBe(200);
  });
  it('keeps signed Stripe webhooks outside operator authentication',async()=>{
    const h=setup();vi.mocked(parseFundingWebhook).mockResolvedValue({eventId:'e',brandId:'sightglass',workspaceId:OTHER,amountCents:100,chargeId:'ch',processingFeeCents:0});
    expect((await h.send('/v1/stripe/webhook','POST',{}, {'stripe-signature':'signed'})).status).toBe(200);expect(h.workspace.fund).toHaveBeenCalled();expect(h.env.EXCHANGE.getByName).toHaveBeenCalledWith(OTHER);
  });
});
