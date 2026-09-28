import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auction, LedgerEntry, Placement } from '../src/shared/types';
import { applyRound, assignFits, createAuction } from '../src/shared/engine';
import { createCampaigns } from '../src/shared/catalog';

vi.mock('cloudflare:workers',()=>({DurableObject:class {constructor(public ctx:unknown,public env:unknown){}}}));
vi.mock('../src/server/payments',()=>({createPublisherTransfer:vi.fn()}));
import { createPublisherTransfer } from '../src/server/payments';
import { harness, closeHarnesses } from './workspace-harness';

type Harness=ReturnType<typeof harness>;
interface Account {balance:number;reserved:number;spent:number}
interface TransferJob {id:string;ledger_id:string;brand_id:string;publisher_id:string;auction_id:string;amount:number;charge_id:string;attempts:number;next_at:number;status:'pending'|'completed';stripe_id?:string;error?:string}
const env={STRIPE_SECRET_KEY:'sk_test_mock',STRIPE_WEBHOOK_SECRET:'whsec_mock',STRIPE_PUBLISHERS:JSON.stringify({wavelength:'acct_publisher'})};
const funding=(chargeId='ch_first',amountCents=100)=>({eventId:`evt_${chargeId}`,brandId:'blue-bottle',workspaceId:'test',amountCents,chargeId,processingFeeCents:33});
const rows=<T>(h:Harness,kind:string):T[]=>h.db.prepare('SELECT data FROM documents WHERE kind=?').all(kind).map(r=>JSON.parse(String(r.data)) as T);

async function reserve(h:Harness,bid=75,id=crypto.randomUUID()):Promise<Auction>{
  let a=createAuction({id,scenario:'dating',intent:'Coffee date',preferences:[],mode:'live',campaigns:createCampaigns(),target_score:100});
  a=assignFits(a,a.bidders.map(b=>({brand_id:b.brand.id,score:80,explanation:'Curated fixture'})));
  a=applyRound(a,{'blue-bottle':{action:'submit',bid_cents:bid,discount_cents:100,explanation:'Offer'},sightglass:{action:'withdraw',explanation:'No bid'},ritual:{action:'withdraw',explanation:'No bid'}});
  a.payment_mode='sandbox';h.put('auction',id,a);
  return h.workspace.action(id,'accept');
}
const settle=(h:Harness,job:TransferJob)=>(h.workspace as unknown as {processTransfer(job:TransferJob):Promise<void>}).processTransfer(job);

beforeEach(()=>{vi.clearAllMocks();vi.mocked(createPublisherTransfer).mockResolvedValue({id:'tr_test'});});
afterEach(()=>{closeHarnesses();vi.useRealTimers();});

describe('durable funding and CPC accounting',()=>{
  it('deduplicates both webhook event ID and source charge ID',async()=>{
    const h=harness(undefined,env);
    await h.workspace.fund(funding());
    await h.workspace.fund(funding());
    await h.workspace.fund({...funding(),eventId:'evt_charge_updated_for_same_checkout_charge'});
    expect(h.get<Account>('account','sandbox:blue-bottle')).toEqual({balance:100,reserved:0,spent:0});
    expect(rows<LedgerEntry>(h,'ledger').filter(l=>l.mode==='sandbox'&&l.kind==='funding')).toHaveLength(1);
    expect(rows<LedgerEntry>(h,'ledger').filter(l=>l.mode==='sandbox'&&l.kind==='processing_fee')).toHaveLength(1);
    expect(rows(h,'lot')).toHaveLength(1);
  });
  it('rejects unknown funded brands without partially crediting a charge',async()=>{
    const h=harness(undefined,env);
    await expect(h.workspace.fund({...funding(),brandId:'unknown'})).rejects.toThrow();
    expect(rows(h,'funding_charge')).toHaveLength(0);
    expect(rows(h,'lot')).toHaveLength(0);
  });
  it('cannot reserve the same budget for two placements',async()=>{
    const h=harness(undefined,env);await h.workspace.fund(funding());
    const first=await reserve(h,75),second=await reserve(h,75);
    expect(first.placement?.status).toBe('reserved');
    expect(second.placement).toBeUndefined();expect(second.end_reason).toBe('insufficient_funds');
    expect(h.get<Account>('account','sandbox:blue-bottle')?.reserved).toBe(75);
  });
  it('charges once across duplicate concurrent clicks and creates one transfer job',async()=>{
    const h=harness(undefined,env);await h.workspace.fund(funding());
    const a=await reserve(h);const placement=a.placement!;
    const [first,second]=await Promise.all([h.workspace.click(placement.id),h.workspace.click(placement.id)]);
    expect(first.ledger?.id).toBe(second.ledger?.id);
    expect(first.ledger?.amount_cents).toBe(75);expect(first.ledger?.publisher_cents).toBe(60);expect(first.ledger?.network_cents).toBe(15);
    expect(h.get<Account>('account','sandbox:blue-bottle')).toEqual({balance:25,reserved:0,spent:75});
    expect(rows<LedgerEntry>(h,'ledger').filter(l=>l.kind==='click')).toHaveLength(1);
    expect(rows<TransferJob>(h,'transfer_job')).toHaveLength(1);
  });
  it('releases an expired reservation and refuses a later click',async()=>{
    const h=harness(undefined,env);await h.workspace.fund(funding());const a=await reserve(h);
    const p=a.placement!;p.expires_at=new Date(Date.now()-1000).toISOString();h.put('placement',p.id,p);
    await expect(h.workspace.click(p.id)).rejects.toThrow('expired');
    expect(h.get<Account>('account','sandbox:blue-bottle')).toEqual({balance:100,reserved:0,spent:0});
    expect(h.get<Placement>('placement',p.id)?.status).toBe('expired');
    expect(rows(h,'transfer_job')).toHaveLength(0);
  });
  it('records a one-cent CPC once and completes without a zero-cent transfer',async()=>{
    const h=harness(undefined,env);await h.workspace.fund(funding());const a=await reserve(h,1);
    const first=await h.workspace.click(a.placement!.id),duplicate=await h.workspace.click(a.placement!.id);
    expect(first.ledger?.id).toBe(duplicate.ledger?.id);
    expect(first.ledger).toMatchObject({amount_cents:1,publisher_cents:0,network_cents:1,status:'completed'});
    expect(h.get<Account>('account','sandbox:blue-bottle')).toEqual({balance:99,reserved:0,spent:1});
    expect(rows(h,'transfer_job')).toHaveLength(0);
    await h.workspace.alarm();expect(createPublisherTransfer).not.toHaveBeenCalled();
  });
  it('rolls back the entire charge if funding lots do not reconcile',async()=>{
    const h=harness(undefined,env);await h.workspace.fund(funding());const a=await reserve(h);
    h.db.prepare('DELETE FROM documents WHERE kind=?').run('lot');
    await expect(h.workspace.click(a.placement!.id)).rejects.toThrow('reconciliation incomplete');
    expect(h.get<Account>('account','sandbox:blue-bottle')).toEqual({balance:100,reserved:75,spent:0});
    expect(h.get<Placement>('placement',a.placement!.id)?.status).toBe('reserved');
    expect(rows<LedgerEntry>(h,'ledger').filter(l=>l.kind==='click')).toHaveLength(0);
  });
  it('splits a five-cent click across five one-cent source remnants without overallocating the final lot',async()=>{
    const h=harness(undefined,env);
    // Simulate five legitimate funding lots each having one unspent cent left.
    for(let i=0;i<5;i++){await h.workspace.fund(funding(`ch_${i}`));h.put('lot',`ch_${i}`,{id:`ch_${i}`,brand_id:'blue-bottle',remaining:1,charge_id:`ch_${i}`});}
    h.put('account','sandbox:blue-bottle',{balance:5,reserved:0,spent:495});
    const a=await reserve(h,5);const result=await h.workspace.click(a.placement!.id);
    const jobs=rows<TransferJob>(h,'transfer_job');
    expect(result.ledger?.publisher_cents).toBe(4);expect(result.ledger?.network_cents).toBe(1);
    expect(jobs.reduce((sum,j)=>sum+j.amount,0)).toBe(4);
    expect(jobs.every(j=>j.amount===1)).toBe(true);
    expect(new Set(jobs.map(j=>j.charge_id)).size).toBe(4);
    expect(rows<{remaining:number}>(h,'lot').every(l=>l.remaining===0)).toBe(true);
  });
  it('retains a pending settlement after provider failure and retries without another click charge',async()=>{
    const h=harness(undefined,env);await h.workspace.fund(funding());const a=await reserve(h);await h.workspace.click(a.placement!.id);
    const initial=rows<TransferJob>(h,'transfer_job')[0];
    vi.mocked(createPublisherTransfer).mockRejectedValueOnce(new Error('Provider temporarily unavailable'));
    await settle(h,initial);
    const pending=h.get<TransferJob>('transfer_job',initial.id)!;
    expect(pending.status).toBe('pending');expect(pending.attempts).toBe(1);
    expect(h.get<LedgerEntry>('ledger',pending.ledger_id)?.status).toBe('pending');
    await settle(h,pending);
    expect(h.get<TransferJob>('transfer_job',initial.id)?.status).toBe('completed');
    expect(h.get<LedgerEntry>('ledger',pending.ledger_id)?.status).toBe('completed');
    const calls=vi.mocked(createPublisherTransfer).mock.calls;
    expect(calls[0][1].idempotencyKey).toBe(calls[1][1].idempotencyKey);
    expect(rows<LedgerEntry>(h,'ledger').filter(l=>l.kind==='click')).toHaveLength(1);
    expect(rows<LedgerEntry>(h,'ledger').filter(l=>l.kind==='transfer')).toHaveLength(1);
    expect(h.get<Account>('account','sandbox:blue-bottle')?.spent).toBe(75);
  });
  it('marks a multi-source click completed only after every source transfer succeeds',async()=>{
    const h=harness(undefined,env);await h.workspace.fund(funding('ch_one'));await h.workspace.fund(funding('ch_two'));
    const a=await reserve(h,150);await h.workspace.click(a.placement!.id);
    const jobs=rows<TransferJob>(h,'transfer_job');expect(jobs.map(j=>j.amount)).toEqual([80,40]);
    await settle(h,jobs[0]);expect(h.get<LedgerEntry>('ledger',jobs[0].ledger_id)?.status).toBe('pending');
    await settle(h,jobs[1]);expect(h.get<LedgerEntry>('ledger',jobs[0].ledger_id)?.status).toBe('completed');
  });
});
