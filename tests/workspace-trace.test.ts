import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentAction, AuditTrace, Auction } from '../src/shared/types';
vi.mock('cloudflare:workers',()=>({DurableObject:class {constructor(public ctx:unknown,public env:unknown){}}}));
vi.mock('../src/server/agents',()=>({assessFits:vi.fn(),decideOffer:vi.fn()}));
import { assessFits, decideOffer } from '../src/server/agents';
import { harness, closeHarnesses } from './workspace-harness';
afterEach(()=>{closeHarnesses();vi.clearAllMocks();vi.useRealTimers();});
const event=(actor:string,kind:string):AuditTrace=>({id:crypto.randomUUID(),at:new Date().toISOString(),kind,actor,correlation_id:`request-${actor}`,status:kind==='model.request'?'pending':'received'});
describe('persisted exchange audit trace',()=>{
  it('preserves concurrent model lifecycle records through fit and sealed round commits',async()=>{
    const h=harness();
    const a=await h.workspace.start({scenario:'dating',intent:'Coffee',preferences:[],mode:'live',payment_mode:'simulation',target_score:100,max_rounds:1,request_path:'/v1/auctions'});
    expect(a.trace?.[0]).toMatchObject({kind:'auction.request',method:'POST',url:'/v1/auctions',payload:{publisher_id:'wavelength'}});
    vi.mocked(assessFits).mockImplementation(async(current,config)=>{
      config.onTrace?.(event('user-agent','model.request'));await Promise.resolve();config.onTrace?.(event('user-agent','model.response'));
      return current.bidders.map(b=>({brand_id:b.brand.id,score:80,explanation:'Coffee fits.'}));
    });
    await h.internal.processAuction(a.id);
    const responseGates:Array<()=>void>=[];
    vi.mocked(decideOffer).mockImplementation(async(current,bidder,config)=>{
      config.onTrace?.(event(bidder.brand.id,'model.request'));
      await new Promise<void>(resolve=>responseGates.push(resolve));
      config.onTrace?.(event(bidder.brand.id,'model.response'));
      return {action:'submit',bid_cents:50,discount_cents:50,explanation:'A public offer.'} satisfies AgentAction;
    });
    const running=h.internal.processAuction(a.id);
    for(let i=0;i<12;i++)await Promise.resolve();
    const pending=h.get<Auction>('auction',a.id)!;
    expect(pending.rounds).toHaveLength(0);
    expect(pending.trace?.filter(t=>t.kind==='model.request')).toHaveLength(4);
    expect(pending.trace?.find(t=>t.kind==='round.started')?.payload).toMatchObject({participants:['blue-bottle','sightglass','ritual']});
    expect(Date.parse(pending.round_deadline!)-Date.parse(pending.round_started_at!)).toBeGreaterThanOrEqual(9990);
    responseGates.forEach(resolve=>resolve());await running;
    expect(h.get<Auction>('auction',a.id)!.rounds).toHaveLength(0);
    vi.useFakeTimers();vi.setSystemTime(Date.parse(pending.round_deadline!)+1);
    await h.internal.processAuction(a.id);
    const completed=h.get<Auction>('auction',a.id)!;
    expect(completed.trace?.filter(t=>t.kind==='model.request')).toHaveLength(4);
    expect(completed.trace?.filter(t=>t.kind==='model.response')).toHaveLength(4);
    expect(completed.trace?.filter(t=>t.kind==='offer.validated')).toHaveLength(3);
    expect(completed.trace?.filter(t=>t.kind==='round.committed')).toHaveLength(1);
    expect(completed.trace?.at(-1)?.kind).toBe('auction.completed');
    expect(completed.status).toBe('completed');
    // Trace is operator observability; agents still receive only prior completed round boards.
    expect(vi.mocked(decideOffer).mock.calls.every(([snapshot])=>snapshot.rounds.length===0)).toBe(true);
    const restarted=harness(h.db);
    expect((await restarted.workspace.readAuction(a.id)).trace).toEqual(completed.trace);
    const click=await restarted.workspace.click(completed.placement!.id);
    await restarted.workspace.click(completed.placement!.id);
    const clicked=await restarted.workspace.readAuction(a.id);
    expect(clicked.trace?.filter(t=>t.kind==='placement.clicked')).toHaveLength(1);
    expect(clicked.trace?.find(t=>t.kind==='placement.clicked')?.payload).toMatchObject({amount_cents:50,publisher_cents:40,network_cents:10,payment_mode:'simulation',ledger_id:click.ledger?.id});
  });
  it('marks simulation decisions as exchange transitions without inventing model network calls',async()=>{
    const h=harness();
    const a=await h.workspace.start({scenario:'dating',intent:'Coffee',preferences:[],mode:'simulation',max_rounds:1});
    await h.internal.processAuction(a.id);await h.internal.processAuction(a.id);
    const completed=await h.workspace.readAuction(a.id);
    expect(completed.trace?.some(t=>t.kind.startsWith('model.'))).toBe(false);
    expect(completed.trace?.some(t=>t.kind==='round.committed')).toBe(true);
    expect(completed.trace?.[0].payload).toMatchObject({mode:'simulation'});
  });
});
