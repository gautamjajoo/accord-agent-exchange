import { DurableObject } from 'cloudflare:workers';
import { brands, scenarios, createCampaigns } from '../shared/catalog';
import { createAuction, assignFits, applyRound, finishAuction, rankOffers, assessSimulatedFits, simulateAgentAction } from '../shared/engine';
import type { Auction, AgentAction, Bootstrap, Campaign, LedgerEntry, Placement, ScenarioId } from '../shared/types';
import { assessFits, decideOffer } from './agents';
import { createPublisherTransfer, type VerifiedFunding } from './payments';

type MoneyMode = 'sandbox'|'simulation';
interface Account {balance:number; reserved:number; spent:number}
interface Job {id:string; deadline:number; round:number; phase:'assessment'|'round'}
interface FundingLot {id:string; brand_id:string; remaining:number; charge_id:string}
interface TransferJob {id:string; ledger_id:string; brand_id:string; publisher_id:string; auction_id:string; amount:number; charge_id:string; attempts:number; next_at:number; status:'pending'|'completed'; stripe_id?:string; error?:string}
const iso = () => new Date().toISOString();
const terminal = (a:Auction) => ['completed','cancelled','failed'].includes(a.status);
const message = (e:unknown) => e instanceof Error ? e.message.slice(0,300) : 'Unexpected service error';

export class ExchangeWorkspace extends DurableObject<Env> {
  constructor(ctx:DurableObjectState, env:Env) {
    super(ctx,env);
    ctx.blockConcurrencyWhile(async()=>{
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS documents (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id))');
      if (!this.get('meta','initialized')) {
        for(const campaign of createCampaigns()) {
          this.put('campaign',campaign.brand_id,campaign);
          this.put('account',`simulation:${campaign.brand_id}`,{balance:10000,reserved:0,spent:0});
          this.put('account',`sandbox:${campaign.brand_id}`,{balance:0,reserved:0,spent:0});
          this.put('ledger',`seed:${campaign.brand_id}`,{id:`seed:${campaign.brand_id}`,kind:'funding',created_at:iso(),brand_id:campaign.brand_id,amount_cents:10000,mode:'simulation',status:'completed'} satisfies LedgerEntry);
        }
        this.put('meta','initialized',{at:iso()});
      }
    });
  }
  private get<T>(kind:string,id:string):T|undefined { const row=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM documents WHERE kind=? AND id=?',kind,id).toArray()[0]; return row ? JSON.parse(row.data) as T : undefined; }
  private put(kind:string,id:string,data:unknown) {this.ctx.storage.sql.exec('INSERT INTO documents(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',kind,id,JSON.stringify(data));}
  private all<T>(kind:string):T[] {return this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM documents WHERE kind=? ORDER BY rowid',kind).toArray().map(r=>JSON.parse(r.data) as T);}
  private del(kind:string,id:string) {this.ctx.storage.sql.exec('DELETE FROM documents WHERE kind=? AND id=?',kind,id);}
  private account(mode:MoneyMode,brandId:string):Account {return this.get<Account>('account',`${mode}:${brandId}`)??{balance:0,reserved:0,spent:0};}
  private mode():MoneyMode {return this.env.STRIPE_SECRET_KEY && this.env.STRIPE_WEBHOOK_SECRET ? 'sandbox':'simulation';}
  private campaigns(mode=this.mode()):Campaign[] {return this.all<Campaign>('campaign').map(c=>{const acc=this.account(mode,c.brand_id);return {...c,balance_cents:acc.balance,reserved_cents:acc.reserved,spent_cents:acc.spent};});}
  private async schedule(at=Date.now()+100) {const current=await this.ctx.storage.getAlarm(); if(current===null || at<current) await this.ctx.storage.setAlarm(at);}
  async bootstrap():Promise<Bootstrap> {
    this.expireReservations();
    return {brands,scenarios,campaigns:this.campaigns(),capabilities:{live_agents:!!this.env.OPENAI_API_KEY,stripe:this.mode()==='sandbox',model:this.env.OPENAI_MODEL,demo_only:true},auctions:this.all<Auction>('auction').reverse().slice(0,30),ledger:this.all<LedgerEntry>('ledger').reverse()};
  }
  async listAuctions() {return this.all<Auction>('auction').reverse().slice(0,50);}
  async readAuction(id:string) {this.expireReservations();const a=this.get<Auction>('auction',id);if(!a)throw new Error('Auction not found');return a;}
  async ledger() {return this.all<LedgerEntry>('ledger').reverse();}
  async start(input:{scenario:ScenarioId;intent:string;preferences:string[];mode:'live'|'simulation';target_score?:number;max_rounds?:number;payment_mode?:MoneyMode}) {
    if(input.mode==='live'&&!this.env.OPENAI_API_KEY)throw new Error('Live GPT agents require OPENAI_API_KEY. Choose explicit simulation or configure the key.');
    if(this.all<Auction>('auction').filter(a=>!terminal(a)).length>=3) throw new Error('Finish or cancel an existing auction before starting another.');
    this.expireReservations();
    if(input.payment_mode==='sandbox'&&(input.mode!=='live'||this.mode()!=='sandbox'))throw new Error('Stripe sandbox requires live agents and configured Stripe credentials.');
    const moneyMode=input.mode==='simulation'?'simulation':input.payment_mode??this.mode();
    const a=createAuction({...input,id:crypto.randomUUID(),campaigns:this.campaigns(moneyMode)});
    a.payment_mode=moneyMode;
    this.put('auction',a.id,a);await this.schedule();return a;
  }
  async action(id:string,action:string) {
    // Read and transition synchronously: awaiting readAuction would yield a stale
    // snapshot that could overwrite a concurrently completed round or action.
    this.expireReservations();
    this.ctx.storage.transactionSync(()=>{
      let a=this.get<Auction>('auction',id);if(!a)throw new Error('Auction not found');
      if(terminal(a))return;
      if(action==='cancel')a=finishAuction(a,'cancelled');
      else if(action==='accept')a=finishAuction(a,'user_accepted');
      else if(action==='pause'){a.pause_requested=true;if(a.status==='running'&&!this.get('job',id))a.status='paused';}
      else if(action==='continue'){a.pause_requested=false;if(a.status==='paused')a.status='running';}
      else throw new Error('Unknown auction action');
      a.updated_at=iso();
      if(a.status==='completed')a=this.reserveWinner(a);
      if(terminal(a))this.del('job',id); // Invalidate every outstanding model response.
      this.put('auction',id,a);
    });
    await this.schedule();
    return this.get<Auction>('auction',id)!;
  }
  async updateCampaign(id:string,patch:Record<string,unknown>) {
    const c=this.get<Campaign>('campaign',id);if(!c)throw new Error('Campaign not found');
    for(const key of ['max_cpc_cents','max_discount_cents'] as const) {
      const value=patch[key];if(value!==undefined){if(!Number.isSafeInteger(value)||Number(value)<(key==='max_cpc_cents'?1:0)||Number(value)>100000)throw new Error('Invalid campaign amount');c[key]=Number(value);}
    }
    if(typeof patch.strategy==='string')c.strategy=patch.strategy.slice(0,1600);
    if(typeof patch.active==='boolean')c.active=patch.active;
    c.version++;this.put('campaign',id,c);return this.campaigns().find(x=>x.brand_id===id);
  }
  async simulationFund(id:string,amount:number) {
    if(!this.get('campaign',id))throw new Error('Campaign not found');
    if(!Number.isSafeInteger(amount)||amount<100||amount>100000)throw new Error('Use a funding amount from $1 to $1,000.');
    this.ctx.storage.transactionSync(()=>{
      const a=this.account('simulation',id);a.balance+=amount;this.put('account',`simulation:${id}`,a);
      const key=crypto.randomUUID();this.put('ledger',key,{id:key,kind:'funding',created_at:iso(),brand_id:id,amount_cents:amount,mode:'simulation',status:'completed'} satisfies LedgerEntry);
    });return this.campaigns('simulation').find(c=>c.brand_id===id);
  }
  async fund(event:VerifiedFunding) {
    this.ctx.storage.transactionSync(()=>{
      if(this.get('funding_event',event.eventId)||this.get('funding_charge',event.chargeId))return;
      if(!this.get('campaign',event.brandId))throw new Error('Unknown funded campaign');
      const acc=this.account('sandbox',event.brandId);acc.balance+=event.amountCents;this.put('account',`sandbox:${event.brandId}`,acc);
      this.put('funding_event',event.eventId,{at:iso()});this.put('funding_charge',event.chargeId,{at:iso()});
      this.put('lot',event.chargeId,{id:event.chargeId,brand_id:event.brandId,remaining:event.amountCents,charge_id:event.chargeId} satisfies FundingLot);
      this.put('ledger',event.eventId,{id:event.eventId,kind:'funding',created_at:iso(),brand_id:event.brandId,amount_cents:event.amountCents,stripe_id:event.chargeId,mode:'sandbox',status:'completed'} satisfies LedgerEntry);
      this.put('ledger',`${event.eventId}:fee`,{id:`${event.eventId}:fee`,kind:'processing_fee',created_at:iso(),brand_id:event.brandId,amount_cents:event.processingFeeCents,stripe_id:event.chargeId,mode:'sandbox',status:'completed'} satisfies LedgerEntry);
    });return {credited:true};
  }
  private reserveWinner(a:Auction):Auction {
    if(a.placement || !a.winner)return a;
    const mode=a.payment_mode??'simulation';
    for(const offer of rankOffers(a)) {
      const acc=this.account(mode,offer.brand_id);
      if(acc.balance-acc.reserved<offer.bid_cents)continue;
      const brand=a.bidders.find(b=>b.brand.id===offer.brand_id)!.brand;
      acc.reserved+=offer.bid_cents;this.put('account',`${mode}:${brand.id}`,acc);
      a.winner=offer;
      a.placement={id:crypto.randomUUID(),auction_id:a.id,publisher_id:a.publisher_id,brand_id:brand.id,offer,item:brand.item,code:brand.code,destination:brand.source_url,expires_at:new Date(Date.now()+600000).toISOString(),status:'reserved'};
      this.put('placement',a.placement.id,a.placement);return a;
    }
    delete a.winner;a.end_reason='insufficient_funds';a.events.push({at:iso(),kind:'funding',message:'No ranked offer could reserve its CPC. Add campaign funds and run another auction.'});return a;
  }
  private expireReservations() {
    this.ctx.storage.transactionSync(()=>{
      for(const p of this.all<Placement>('placement')) {
        if(p.status!=='reserved'||Date.parse(p.expires_at)>Date.now())continue;
        const a=this.get<Auction>('auction',p.auction_id)!;const mode=a.payment_mode??'simulation';
        const acc=this.account(mode,p.brand_id);acc.reserved-=p.offer.bid_cents;this.put('account',`${mode}:${p.brand_id}`,acc);
        p.status='expired';this.put('placement',p.id,p);a.placement=p;this.put('auction',a.id,a);
      }
    });
  }
  async click(id:string) {
    this.expireReservations();
    const result=this.ctx.storage.transactionSync(()=>{
      const p=this.get<Placement>('placement',id);if(!p)throw new Error('Placement not found');
      if(p.status==='expired')throw new Error('This placement expired. Start a new auction.');
      if(p.status==='clicked')return {placement:p,ledger:this.get<LedgerEntry>('ledger',p.ledger_id!),destination:p.destination};
      const a=this.get<Auction>('auction',p.auction_id)!;const mode=a.payment_mode??'simulation';
      const acc=this.account(mode,p.brand_id);const amount=p.offer.bid_cents;
      const publisher=Math.floor(amount*4/5);
      acc.balance-=amount;acc.reserved-=amount;acc.spent+=amount;
      this.put('account',`${mode}:${p.brand_id}`,acc);
      const entry:LedgerEntry={id:`click:${p.id}`,kind:'click',created_at:iso(),brand_id:p.brand_id,publisher_id:p.publisher_id,auction_id:a.id,amount_cents:amount,publisher_cents:publisher,network_cents:amount-publisher,mode,status:mode==='simulation'?'completed':'pending'};
      this.put('ledger',entry.id,entry);p.status='clicked';p.ledger_id=entry.id;this.put('placement',id,p);a.placement=p;this.put('auction',a.id,a);
      if(mode==='sandbox') {
        let remaining=amount;
        for(const lot of this.all<FundingLot>('lot').filter(l=>l.brand_id===p.brand_id&&l.remaining>0)) {
          const taken=Math.min(remaining,lot.remaining);if(!taken)break;
          // Cumulative rounding distributes residual cents across lots without
          // allocating more to a transfer than its own source-charge portion.
          const consumed=amount-remaining;
          const share=Math.floor((consumed+taken)*4/5)-Math.floor(consumed*4/5);
          lot.remaining-=taken;remaining-=taken;this.put('lot',lot.id,lot);
          if(share>0){const key=`${entry.id}:${lot.id}`;this.put('transfer_job',key,{id:key,ledger_id:entry.id,brand_id:p.brand_id,publisher_id:p.publisher_id,auction_id:a.id,amount:share,charge_id:lot.charge_id,attempts:0,next_at:Date.now(),status:'pending'} satisfies TransferJob);}
          if(!remaining)break;
        }
        if(remaining)throw new Error('Funding reconciliation incomplete; no click charge was committed.');
        if(publisher===0){entry.status='completed';this.put('ledger',entry.id,entry);}
      }
      return {placement:p,ledger:entry,destination:p.destination};
    });
    await this.schedule();return result;
  }
  private async processTransfer(job:TransferJob) {
    try {
      const destinations=JSON.parse(this.env.STRIPE_PUBLISHERS||'{}') as Record<string,string>;
      const destinationAccount=destinations[job.publisher_id];if(!destinationAccount)throw new Error(`Configure STRIPE_PUBLISHERS for ${job.publisher_id}.`);
      const result=await createPublisherTransfer(this.env.STRIPE_SECRET_KEY,{amountCents:job.amount,destinationAccount,sourceChargeId:job.charge_id,idempotencyKey:job.id,auctionId:job.auction_id});
      this.ctx.storage.transactionSync(()=>{
        job.status='completed';job.stripe_id=result.id;delete job.error;this.put('transfer_job',job.id,job);
        this.put('ledger',`transfer:${job.id}`,{id:`transfer:${job.id}`,kind:'transfer',created_at:iso(),brand_id:job.brand_id,publisher_id:job.publisher_id,auction_id:job.auction_id,amount_cents:job.amount,stripe_id:result.id,mode:'sandbox',status:'completed'} satisfies LedgerEntry);
        if(this.all<TransferJob>('transfer_job').filter(j=>j.ledger_id===job.ledger_id).every(j=>j.status==='completed')){const entry=this.get<LedgerEntry>('ledger',job.ledger_id)!;entry.status='completed';delete entry.error;this.put('ledger',entry.id,entry);}
      });
    } catch(e) {
      job.attempts++;job.next_at=Date.now()+Math.min(600000,10000*2**Math.min(job.attempts,6));job.error=message(e);this.put('transfer_job',job.id,job);
      const entry=this.get<LedgerEntry>('ledger',job.ledger_id)!;entry.error=job.error;this.put('ledger',entry.id,entry);
    }
  }
  private async processAuction(id:string) {
    let a=this.get<Auction>('auction',id);if(!a||terminal(a)||a.status==='paused')return;
    const existing=this.get<Job>('job',id);
    if(existing) {
      if(existing.deadline>Date.now()){await this.schedule(existing.deadline+50);return;}
      if(existing.phase==='assessment') {
        // No await between the ownership check and this recovery transition.
        a=finishAuction(a,'assessment_failed');a.error='Fit assessment timed out or was interrupted. Retry the auction.';
        this.ctx.storage.transactionSync(()=>{this.put('auction',id,a);this.del('job',id);});return;
      }
      this.commitRound(id,existing);return;
    }
    const job:Job={id:crypto.randomUUID(),deadline:Date.now()+(a.status==='assessing'?20000:10000),round:a.current_round,phase:a.status==='assessing'?'assessment':'round'};
    this.ctx.storage.transactionSync(()=>{
      this.put('job',id,job);
      if(job.phase==='round'){
        a!.round_started_at=iso();a!.round_deadline=new Date(job.deadline).toISOString();this.put('auction',id,a);
      }
    });
    await this.schedule(job.deadline+100);
    // schedule performs asynchronous storage operations; the user can accept or
    // cancel while it yields. Never restore the pre-await auction snapshot.
    const fresh=this.get<Auction>('auction',id);
    if(!fresh||terminal(fresh)||this.get<Job>('job',id)?.id!==job.id)return;
    a=fresh;
    if(job.phase==='assessment') {
      try {
        const fits=a.mode==='live'?await assessFits(a,{apiKey:this.env.OPENAI_API_KEY,model:this.env.OPENAI_MODEL},AbortSignal.timeout(Math.max(1,job.deadline-Date.now()))):assessSimulatedFits(a);
        const current=this.get<Auction>('auction',id)!;
        if(terminal(current)||this.get<Job>('job',id)?.id!==job.id)return;
        if(Date.now()>job.deadline)throw new Error('Fit assessment arrived after its deadline. Retry the auction.');
        const assessed=assignFits(current,fits);
        if(assessed.pause_requested&&assessed.status==='running')assessed.status='paused';
        this.ctx.storage.transactionSync(()=>{this.put('auction',id,assessed);this.del('job',id);});
      }catch(e){
        const current=this.get<Auction>('auction',id)!;
        if(terminal(current)||this.get<Job>('job',id)?.id!==job.id)return;
        const failed=finishAuction(current,'assessment_failed');failed.error=message(e);
        this.ctx.storage.transactionSync(()=>{this.put('auction',id,failed);this.del('job',id);});
      }
    } else {
      const frozen=structuredClone(a);
      await Promise.all(frozen.bidders.filter(b=>!b.finalized&&!b.withdrawn).map(async bidder=>{
        let result:AgentAction|string;
        try {
          result=frozen.mode==='live'?await decideOffer(frozen,bidder,{apiKey:this.env.OPENAI_API_KEY,model:this.env.OPENAI_MODEL},AbortSignal.timeout(Math.max(1,job.deadline-Date.now()))):simulateAgentAction(frozen,bidder);
        }catch(e){result=`${Date.now()>=job.deadline?'timeout':'error'}: ${message(e)}`;}
        const current=this.get<Auction>('auction',id)!;
        if(terminal(current)||this.get<Job>('job',id)?.id!==job.id){
          current.events.push({at:iso(),kind:'ignored',message:`Late ${bidder.brand.name} response discarded; its round is no longer active.`});this.put('auction',id,current);return;
        }
        if(Date.now()>job.deadline&&typeof result!=='string')result='timeout: offer arrived after the round deadline';
        this.put('submission',`${id}:${job.round}:${bidder.brand.id}`,result);
      }));
      this.commitRound(id,job);
    }
    await this.schedule(Date.now()+1200);
  }
  private commitRound(id:string,job:Job) {
    this.ctx.storage.transactionSync(()=>{
      const current=this.get<Auction>('auction',id);
      if(!current||current.status!=='running'||this.get<Job>('job',id)?.id!==job.id||job.phase!=='round'||current.current_round!==job.round)return;
      const actions:Record<string,AgentAction|string>={};
      for(const b of current.bidders){
        if(b.finalized||b.withdrawn)continue;
        const entry=this.get<AgentAction|string>('submission',`${id}:${job.round}:${b.brand.id}`);if(entry)actions[b.brand.id]=entry;
      }
      let updated=applyRound(current,actions);if(updated.status==='completed')updated=this.reserveWinner(updated);
      this.put('auction',id,updated);this.del('job',id);
    });
  }
  async alarm() {
    this.expireReservations();
    await Promise.all(this.all<Auction>('auction').filter(a=>a.status==='assessing'||a.status==='running').map(a=>this.processAuction(a.id)));
    await Promise.all(this.all<TransferJob>('transfer_job').filter(j=>j.status==='pending'&&j.next_at<=Date.now()).map(j=>this.processTransfer(j)));
    const next:number[]=[];
    for(const a of this.all<Auction>('auction'))if(a.status==='running'||a.status==='assessing')next.push(this.get<Job>('job',a.id)?.deadline??Date.now()+1200);
    for(const p of this.all<Placement>('placement'))if(p.status==='reserved')next.push(Date.parse(p.expires_at));
    for(const j of this.all<TransferJob>('transfer_job'))if(j.status==='pending')next.push(j.next_at);
    if(next.length)await this.schedule(Math.max(Date.now()+100,Math.min(...next)));
  }
}
