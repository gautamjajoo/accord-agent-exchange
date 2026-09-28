import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentAction, Auction } from '../src/shared/types';
import { applyRound, assignFits, createAuction } from '../src/shared/engine';
import { createCampaigns } from '../src/shared/catalog';

vi.mock('cloudflare:workers',()=>({DurableObject:class {constructor(public ctx:unknown,public env:unknown){}}}));
vi.mock('../src/server/agents',()=>({assessFits:vi.fn(),decideOffer:vi.fn()}));
import { harness, closeHarnesses } from './workspace-harness';
import { assessFits, decideOffer } from '../src/server/agents';

interface Job {id:string;deadline:number;round:number;phase:'assessment'|'round'}
const submit=(bid_cents:number,discount_cents:number,final=false):AgentAction=>({action:'submit',bid_cents,discount_cents,explanation:'Test offer',final});
function initial(id='auction'):Auction {
  let a=createAuction({id,scenario:'dating',intent:'Coffee',preferences:[],mode:'live',campaigns:createCampaigns(),target_score:100});
  a=assignFits(a,a.bidders.map(b=>({brand_id:b.brand.id,score:80,explanation:'Equal fit'})));
  a.payment_mode='simulation';return a;
}
function afterRoundOne(){return applyRound(initial(),{'blue-bottle':submit(150,100),sightglass:submit(100,0),ritual:submit(100,0)});}
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}

beforeEach(()=>vi.clearAllMocks());
afterEach(()=>{closeHarnesses();vi.useRealTimers();});

describe('durable auction orchestration',()=>{
  it('persists live submissions until the sealed window closes without repeating model calls',async()=>{
    vi.useFakeTimers();
    const h=harness();h.put('auction','auction',initial());
    vi.mocked(decideOffer).mockResolvedValue(submit(100,100));
    await h.internal.processAuction('auction');
    const job=h.get<Job>('job','auction')!;
    expect(h.get<Auction>('auction','auction')!.rounds).toHaveLength(0);
    expect(h.get('submission','auction:1:sightglass')).toBeDefined();
    await h.internal.processAuction('auction');
    expect(decideOffer).toHaveBeenCalledTimes(3);
    vi.setSystemTime(job.deadline+1);
    await h.internal.processAuction('auction');
    expect(h.get<Auction>('auction','auction')!.rounds).toHaveLength(1);
    expect(decideOffer).toHaveBeenCalledTimes(3);
  });
  it('does not resurrect a cancellation while round scheduling awaits storage',async()=>{
    const h=harness();h.put('auction','auction',afterRoundOne());
    const gate=deferred<number|null>();h.storage.getAlarm.mockImplementationOnce(()=>gate.promise);
    const running=h.internal.processAuction('auction');
    await h.workspace.action('auction','cancel');
    gate.resolve(null);await running;
    const a=h.get<Auction>('auction','auction')!;
    expect(a.status).toBe('cancelled');expect(a.rounds).toHaveLength(1);expect(decideOffer).not.toHaveBeenCalled();expect(h.get('job','auction')).toBeUndefined();
  });
  it('accepts the completed round while later agents run and discards every late response',async()=>{
    const h=harness();const original=afterRoundOne();h.put('auction','auction',original);
    const gate=deferred<AgentAction>();vi.mocked(decideOffer).mockReturnValue(gate.promise);
    const running=h.internal.processAuction('auction');await flush();expect(decideOffer).toHaveBeenCalledTimes(3);
    const accepted=await h.workspace.action('auction','accept');expect(accepted.winner?.brand_id).toBe('blue-bottle');
    gate.resolve(submit(100,400));await running;
    const a=h.get<Auction>('auction','auction')!;
    expect(a.end_reason).toBe('user_accepted');expect(a.rounds).toHaveLength(1);expect(a.winner).toEqual(accepted.winner);
    expect(a.events.filter(e=>e.kind==='ignored')).toHaveLength(3);
    expect(h.get('submission','auction:2:sightglass')).toBeUndefined();
  });
  it('cancels an in-flight round without creating a placement',async()=>{
    const h=harness();h.put('auction','auction',afterRoundOne());
    const gate=deferred<AgentAction>();vi.mocked(decideOffer).mockReturnValue(gate.promise);
    const running=h.internal.processAuction('auction');await flush();
    await h.workspace.action('auction','cancel');gate.resolve(submit(100,400));await running;
    const a=h.get<Auction>('auction','auction')!;expect(a.status).toBe('cancelled');expect(a.placement).toBeUndefined();expect(a.winner).toBeUndefined();expect(a.rounds).toHaveLength(1);
  });
  it('never dispatches a new model turn to a finalized or withdrawn bidder',async()=>{
    const h=harness();const a=applyRound(initial(),{'blue-bottle':submit(150,100,true),sightglass:submit(100,0),ritual:{action:'withdraw',explanation:'Done'}});h.put('auction',a.id,a);
    vi.mocked(decideOffer).mockResolvedValue(submit(100,200));await h.internal.processAuction(a.id);
    expect(decideOffer).toHaveBeenCalledTimes(1);expect(vi.mocked(decideOffer).mock.calls[0][1].brand.id).toBe('sightglass');
    expect(h.get<Auction>('auction',a.id)!.bidders[0].offer).toEqual({bid_cents:150,discount_cents:100});
  });
  it('recovers a persisted expired round from its submitted offers exactly once',async()=>{
    const h=harness(), a=afterRoundOne();h.put('auction',a.id,a);
    const job:Job={id:'interrupted',deadline:Date.now()-1,round:2,phase:'round'};h.put('job',a.id,job);
    h.put('submission',`${a.id}:2:sightglass`,submit(100,400));
    const recovered=harness(h.db);await recovered.internal.processAuction(a.id);
    const result=recovered.get<Auction>('auction',a.id)!;
    expect(result.rounds).toHaveLength(2);expect(result.rounds[1].leader_id).toBe('sightglass');expect(result.bidders[0].last_action).toBe('timeout');
    expect(decideOffer).not.toHaveBeenCalled();expect(recovered.get('job',a.id)).toBeUndefined();
    recovered.internal.commitRound(a.id,job);expect(recovered.get<Auction>('auction',a.id)!.rounds).toHaveLength(2);
  });
  it('waits for an existing round deadline instead of dispatching duplicate turns',async()=>{
    const h=harness();h.put('auction','auction',afterRoundOne());h.put('job','auction',{id:'active',deadline:Date.now()+9000,round:2,phase:'round'});
    await h.internal.processAuction('auction');expect(decideOffer).not.toHaveBeenCalled();expect(h.get<Auction>('auction','auction')!.rounds).toHaveLength(1);
  });
  it('marks an interrupted assessment failed and allows no late result to restore it',async()=>{
    const h=harness();const a=createAuction({id:'assessment',scenario:'dating',intent:'Coffee',preferences:[],mode:'live',campaigns:createCampaigns()});h.put('auction',a.id,a);
    const gate=deferred<never>();vi.mocked(assessFits).mockReturnValue(gate.promise);
    const pending=h.internal.processAuction(a.id);await flush();
    const job=h.get<Job>('job',a.id)!;job.deadline=Date.now()-1;h.put('job',a.id,job);
    await h.internal.processAuction(a.id);gate.reject(new Error('Provider failed later'));await pending;
    const result=h.get<Auction>('auction',a.id)!;expect(result.status).toBe('failed');expect(result.end_reason).toBe('assessment_failed');expect(result.error).toContain('timed out or was interrupted');
  });
  it('preserves a newer job if an older assessment callback fails',async()=>{
    const h=harness();const a=createAuction({id:'assessment',scenario:'dating',intent:'Coffee',preferences:[],mode:'live',campaigns:createCampaigns()});h.put('auction',a.id,a);
    const gate=deferred<never>();vi.mocked(assessFits).mockReturnValue(gate.promise);
    const pending=h.internal.processAuction(a.id);await flush();
    h.put('job',a.id,{id:'new-owner',deadline:Date.now()+10000,round:0,phase:'assessment'});
    gate.reject(new Error('Old provider failed'));await pending;
    expect(h.get<Job>('job',a.id)!.id).toBe('new-owner');expect(h.get<Auction>('auction',a.id)!.status).toBe('assessing');
  });
});
