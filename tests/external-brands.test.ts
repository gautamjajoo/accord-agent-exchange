import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentToken, hashAgentToken, validateExternalAction, validateMerchantDestination, validateRegistration, verifyAgentToken } from '../src/server/external-brands';
import type { Auction, Bidder } from '../src/shared/types';
import { applyRound, assignFits } from '../src/shared/engine';
vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
vi.mock('../src/server/agents', () => ({ assessFits: vi.fn(), decideOffer: vi.fn() }));
import { harness, closeHarnesses } from './workspace-harness';
afterEach(() => closeHarnesses());

const ID = 'brand-0e756852-e5c5-4826-9eac-53b45f4b03d6';
const NOW = '2026-09-28T21:00:00.000Z';
const registration = () => ({ name:'Independent Coffee', scenario:'dating', item:'Two coffees', description:'Small café in San Francisco.', base_price_cents:1400, source_url:'https://independentcoffee.com/menu', facts:['Indoor seating'], tags:['coffee'], code:'COFFEE-PILOT', max_cpc_cents:200, max_discount_cents:600 });
function bidder(): Bidder {
  const { brand, campaign } = validateRegistration(registration(), ID, NOW);
  return { brand, campaign:{...campaign,active:true,balance_cents:10000}, fit:{brand_id:ID,score:80,explanation:'Fit.'}, offer:null, finalized:false, withdrawn:false, last_action:'waiting', explanation:'Waiting.' };
}
const submit = (bid_cents = 100, discount_cents = 100) => ({ action:'submit' as const,bid_cents,discount_cents,explanation:'A better price for this customer.' });

describe('external brand registration', () => {
  it('normalizes an invited catalog and creates an inactive unfunded campaign', () => {
    const result = validateRegistration({...registration(),name:'  Independent Coffee  '}, ID, NOW);
    expect(result.brand).toMatchObject({id:ID,name:'Independent Coffee',initials:'IC',source_date:'2026-09-28',price_kind:'demo_quote'});
    expect(result.campaign).toMatchObject({brand_id:ID,version:1,active:false,balance_cents:0,reserved_cents:0,spent_cents:0,max_cpc_cents:200});
  });
  it.each(['dating','fashion','outings'])('accepts the supported %s scenario', scenario => {
    expect(validateRegistration({...registration(),scenario},ID,NOW).brand.scenario).toBe(scenario);
  });
  it.each(['id','brand_id','token_hash','balance_cents','active'])('rejects client-owned %s fields', field => {
    expect(() => validateRegistration({...registration(),[field]:'injected'},ID,NOW)).toThrow('Unexpected');
  });
  it('requires a server-generated brand identifier', () => {
    expect(() => validateRegistration(registration(),'ritual',NOW)).toThrow('server-generated');
  });
  it.each([null,[], {scenario:'travel'}, {scenario:['dating']}, {name:''}, {name:'x'.repeat(101)}, {description:'x'.repeat(1501)}, {facts:['x'.repeat(501)]}, {tags:new Array(13).fill('tag')}, {color:'red'}, {code:'<script>'}, {source_date:'2026-02-30'}, {price_kind:'live'}])('rejects invalid registration content %#', value => {
    const input = value && !Array.isArray(value) ? {...registration(),...value} : value;
    expect(() => validateRegistration(input,ID,NOW)).toThrow();
  });
  it.each([{base_price_cents:0},{base_price_cents:100.5},{base_price_cents:1_000_001},{max_cpc_cents:0},{max_cpc_cents:10_001},{max_cpc_cents:'100'},{max_discount_cents:-1},{max_discount_cents:1401}])('rejects invalid monetary limits %#', patch => {
    expect(() => validateRegistration({...registration(),...patch},ID,NOW)).toThrow();
  });
});

describe('approved merchant destinations', () => {
  it('accepts a public HTTPS merchant link', () => {
    expect(validateMerchantDestination('https://www.bluebottlecoffee.com/menu?cafe=sf')).toBe('https://www.bluebottlecoffee.com/menu?cafe=sf');
  });
  it.each(['http://merchant.com','https://localhost','https://foo.localhost','https://service.internal','https://machine.local','https://127.0.0.1','https://2130706433','https://0177.0.0.1','https://0x7f000001','https://10.0.0.1','https://172.16.0.1','https://192.168.1.1','https://169.254.169.254','https://[::1]','https://[fd00::1]','https://[::ffff:127.0.0.1]','https://user:pass@merchant.com','https://merchant.com:8443','javascript:alert(1)','https://example.test'])('rejects non-public or unapproved URL %s', value => {
    expect(() => validateMerchantDestination(value)).toThrow();
  });
});

describe('external action contracts', () => {
  it('returns a normalized, structured submission', () => {
    expect(validateExternalAction({...submit(),explanation:'  Better value.  ',final:true},bidder())).toEqual({...submit(),explanation:'Better value.',final:true});
  });
  it('allows withdrawal without an offer', () => {
    expect(validateExternalAction({action:'withdraw',explanation:'No suitable offer.'},bidder()).action).toBe('withdraw');
  });
  it.each(['hold','finalize'])('requires an existing offer for %s', action => {
    expect(() => validateExternalAction({action,explanation:'Keep offer.'},bidder())).toThrow('previous offer');
    const b = bidder(); b.offer={bid_cents:100,discount_cents:100};
    expect(validateExternalAction({action,explanation:'Keep offer.'},b).action).toBe(action);
  });
  it.each([{bid_cents:0},{bid_cents:201},{bid_cents:1.5},{bid_cents:'10'},{discount_cents:-1},{discount_cents:601},{discount_cents:0.5},{final:'false'},{brand_id:'ritual'},{action:'revise'},{action:['submit']},{explanation:'x'.repeat(501)}])('rejects invalid or identity-bearing action %#', patch => {
    expect(() => validateExternalAction({...submit(),...patch},bidder())).toThrow();
  });
  it('checks available funds and frozen limits', () => {
    const b=bidder(); b.campaign.balance_cents=150; b.campaign.reserved_cents=60;
    expect(() => validateExternalAction(submit(100),b)).toThrow('budget');
  });
  it('rejects reductions in either bid or discount', () => {
    const b=bidder(); b.offer={bid_cents:100,discount_cents:100};
    expect(() => validateExternalAction(submit(99,100),b)).toThrow('reduce');
    expect(() => validateExternalAction(submit(100,99),b)).toThrow('reduce');
    expect(validateExternalAction(submit(100,100),b).action).toBe('submit');
  });
  it.each(['finalized','withdrawn'] as const)('rejects further actions from %s bidders', field => {
    const b=bidder(); b[field]=true;
    expect(() => validateExternalAction(submit(),b)).toThrow('closed');
  });
  it('rejects fields not belonging to non-submit actions', () => {
    expect(() => validateExternalAction({action:'withdraw',explanation:'Exit.',bid_cents:1},bidder())).toThrow('Unexpected');
  });
});

describe('external bearer credentials', () => {
  it('generates independent 256-bit credentials', () => {
    const first=createAgentToken(),second=createAgentToken();
    expect(first).toMatch(/^accord_brand_[a-f0-9]{64}$/); expect(second).not.toBe(first);
  });
  it('hashes and verifies without returning a credential in persisted data', async () => {
    const token=createAgentToken(),hash=await hashAgentToken(token);
    expect(hash).toHaveLength(64); expect(hash).not.toContain(token);
    expect(await hashAgentToken(token)).toBe(hash);
    expect(await verifyAgentToken(token,hash)).toBe(true);
    expect(await verifyAgentToken(createAgentToken(),hash)).toBe(false);
    expect(await verifyAgentToken('invalid',hash)).toBe(false);
    expect(await verifyAgentToken(token,'invalid')).toBe(false);
  });
});

describe('external agent workspace integration', () => {
  async function activeFixture() {
    const h=harness();
    const invited=await h.workspace.registerBrandAgent(registration());
    await h.workspace.simulationFund(invited.brand.id,10000);
    await h.workspace.updateCampaign(invited.brand.id,{active:true});
    const created=await h.workspace.start({scenario:'dating',intent:'A café for two.',preferences:['casual'],mode:'live',payment_mode:'simulation',target_score:100});
    const auction=assignFits(created,created.bidders.map(b=>({brand_id:b.brand.id,score:80,explanation:'A suitable café.'})));
    const job={id:'sealed-round-one',deadline:Date.now()+10000,round:1,phase:'round' as const};
    h.put('auction',auction.id,auction);h.put('job',auction.id,job);
    return {...h,invited,auction,job};
  }
  it('keeps invitations unfunded and private until explicitly activated',async()=>{
    const h=harness(),invited=await h.workspace.registerBrandAgent(registration());
    const state=await h.workspace.brandAgentStatus(invited.token);
    expect(state.active).toBe(false);expect(state.campaign.balance_cents).toBe(0);
    const bootstrap=await h.workspace.bootstrap();
    expect(bootstrap.brands.some(b=>b.id===invited.brand.id)).toBe(true);
    expect(JSON.stringify(bootstrap)).not.toContain(invited.token);
    expect(JSON.stringify(bootstrap)).not.toContain('token_hash');
    expect(JSON.stringify(await h.workspace.listBrandAgents())).not.toContain('token_hash');
    const stored=h.get<{token_hash:string}>('brand_agent',invited.brand.id)!;
    expect(stored.token_hash).toBe(await hashAgentToken(invited.token));
  });
  it('adds activated external catalogs to the same auction with frozen identity',async()=>{
    const h=await activeFixture();
    expect(h.auction.bidders).toHaveLength(4);
    const external=h.auction.bidders.find(b=>b.brand.id===h.invited.brand.id)!;
    expect(external.campaign.agent_kind).toBe('external');
    expect(external.campaign.balance_cents).toBe(10000);
    const feed=await h.workspace.brandAgentOpportunities(h.invited.token);
    expect(feed.opportunities).toHaveLength(1);
    expect(feed.opportunities[0].own_catalog.id).toBe(h.invited.brand.id);
    expect(feed.opportunities[0].public_board).toEqual([]);
  });
  it('only publishes the previous completed board even with competitor sealed submissions',async()=>{
    const h=await activeFixture();
    const actions=Object.fromEntries(h.auction.bidders.map(b=>[b.brand.id,submit(100,100)]));
    const next=applyRound(h.auction,actions);
    const nextJob={...h.job,id:'sealed-round-two',round:2};
    h.put('auction',next.id,next);h.put('job',next.id,nextJob);
    h.put('submission',`${next.id}:2:ritual`,{...submit(139,477),explanation:'PRIVATE-UNCOMMITTED-MARKER'});
    const feed=await h.workspace.brandAgentOpportunities(h.invited.token);
    expect(feed.opportunities[0].public_board).toEqual(next.rounds[0].offers);
    expect(JSON.stringify(feed)).not.toContain('PRIVATE-UNCOMMITTED-MARKER');
    expect(JSON.stringify(feed)).not.toContain('token_hash');
    expect(Object.keys(feed.opportunities[0])).not.toContain('bidders');
  });
  it('stores one sealed action, acknowledges exact retries, and rejects replacements',async()=>{
    const h=await activeFixture();
    const envelope={auction_id:h.auction.id,round:1,round_token:h.job.id,action:submit()};
    expect(await h.workspace.submitBrandAgentAction(h.invited.token,envelope)).toMatchObject({accepted:true,idempotent:false});
    expect(await h.workspace.submitBrandAgentAction(h.invited.token,envelope)).toMatchObject({accepted:true,idempotent:true});
    await expect(h.workspace.submitBrandAgentAction(h.invited.token,{...envelope,action:submit(110,150)})).rejects.toThrow('already has');
    expect((await h.workspace.brandAgentOpportunities(h.invited.token)).opportunities).toEqual([]);
    expect(h.get<Auction>('auction',h.auction.id)?.bidders.find(b=>b.brand.id===h.invited.brand.id)?.offer).toBeNull();
    expect(h.get<Auction>('auction',h.auction.id)?.trace?.filter(e=>e.kind==='agent.submission')).toHaveLength(1);
  });
  it('rejects unknown credentials, stale round tokens, expired windows, and revoked access',async()=>{
    const h=await activeFixture();
    const envelope={auction_id:h.auction.id,round:1,round_token:h.job.id,action:submit()};
    await expect(h.workspace.submitBrandAgentAction(createAgentToken(),envelope)).rejects.toThrow('authentication');
    await expect(h.workspace.submitBrandAgentAction(h.invited.token,{...envelope,round_token:'stale'})).rejects.toThrow('stale');
    h.put('job',h.auction.id,{...h.job,deadline:Date.now()-1});
    await expect(h.workspace.submitBrandAgentAction(h.invited.token,envelope)).rejects.toThrow('closed');
    expect(h.get('submission',`${h.auction.id}:1:${h.invited.brand.id}`)).toBeUndefined();
    await h.workspace.revokeBrandAgent(h.invited.brand.id);
    await expect(h.workspace.brandAgentStatus(h.invited.token)).rejects.toThrow('authentication');
    await expect(h.workspace.brandAgentOpportunities(h.invited.token)).rejects.toThrow('authentication');
    await expect(h.workspace.updateCampaign(h.invited.brand.id,{active:true})).rejects.toThrow('Revoked');
  });
});
