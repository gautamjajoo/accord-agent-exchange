import { DurableObject } from 'cloudflare:workers';
import { brands, scenarios, createCampaigns } from '../shared/catalog';
import { createAuction, assignFits, applyRound, finishAuction, rankOffers, assessSimulatedFits, simulateAgentAction } from '../shared/engine';
import type { Auction, AgentAction, AuditTrace, Bootstrap, Brand, Campaign, LedgerEntry, Placement, ScenarioId, TraceJSON } from '../shared/types';
import { assessFits, decideOffer } from './agents';
import { createPublisherTransfer, type VerifiedFunding } from './payments';
import { createAgentToken, hashAgentToken, validateRegistration, validateExternalAction, type ExternalBrandRecord } from './external-brands';

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
  private audit(a:Auction,kind:string,payload:unknown,details:Partial<AuditTrace>={}) {
    (a.trace??=[]).push({id:crypto.randomUUID(),at:iso(),kind,actor:'exchange',round:a.current_round,payload:JSON.parse(JSON.stringify(payload)) as TraceJSON,...details});
  }
  private modelTrace(id:string,event:AuditTrace) {
    const current=this.get<Auction>('auction',id);if(!current)return;
    (current.trace??=[]).push(event);current.updated_at=event.at;this.put('auction',id,current);
  }
  private account(mode:MoneyMode,brandId:string):Account {return this.get<Account>('account',`${mode}:${brandId}`)??{balance:0,reserved:0,spent:0};}
  private mode():MoneyMode {return this.env.STRIPE_SECRET_KEY && this.env.STRIPE_WEBHOOK_SECRET ? 'sandbox':'simulation';}
  private campaigns(mode=this.mode()):Campaign[] {return this.all<Campaign>('campaign').map(c=>{const acc=this.account(mode,c.brand_id);return {...c,balance_cents:acc.balance,reserved_cents:acc.reserved,spent_cents:acc.spent};});}
  private catalog():Brand[] {return [...brands,...this.all<ExternalBrandRecord>('brand_agent').map(r=>r.brand)];}
  async hasBrand(id:string) {return this.catalog().some(b=>b.id===id);}
  async listBrandAgents() {return {agents:this.all<ExternalBrandRecord>('brand_agent').map(r=>({brand:r.brand,created_at:r.created_at,revoked:!!r.revoked_at,last_seen_at:this.get<{at:string}>('agent_seen',r.brand.id)?.at,active:this.get<Campaign>('campaign',r.brand.id)?.active??false}))};}
  async registerBrandAgent(input:unknown) {
    const id=`brand-${crypto.randomUUID()}`;
    const {brand,campaign}=validateRegistration(input,id);
    const token=createAgentToken(),token_hash=await hashAgentToken(token);
    this.ctx.storage.transactionSync(()=>{
      if(this.all('brand_agent').length>=20)throw new Error('Pilot workspace supports up to 20 invited brands.');
      this.put('brand_agent',id,{brand,token_hash,created_at:iso()} satisfies ExternalBrandRecord);
      this.put('campaign',id,{...campaign,agent_kind:'external'} satisfies Campaign);
      for(const mode of ['simulation','sandbox'])this.put('account',`${mode}:${id}`,{balance:0,reserved:0,spent:0});
    });
    return {brand,token};
  }
  async revokeBrandAgent(id:string) {
    this.ctx.storage.transactionSync(()=>{
      const r=this.get<ExternalBrandRecord>('brand_agent',id);if(!r)throw new Error('Brand agent not found');
      r.revoked_at=iso();this.put('brand_agent',id,r);
      const campaign=this.get<Campaign>('campaign',id)!;campaign.active=false;campaign.version++;this.put('campaign',id,campaign);
    });return {revoked:true};
  }
  private async authenticatedBrand(token:string) {
    if(typeof token!=='string'||token.length<24||token.length>512)throw new Error('Agent authentication required');
    const hash=await hashAgentToken(token);
    const record=this.all<ExternalBrandRecord>('brand_agent').find(r=>r.token_hash===hash&&!r.revoked_at);
    if(!record)throw new Error('Agent authentication required');
    const seen=this.get<{at:string}>('agent_seen',record.brand.id);
    if(!seen||Date.now()-Date.parse(seen.at)>15000)this.put('agent_seen',record.brand.id,{at:iso()});
    return record;
  }
  async brandAgentStatus(token:string) {
    const r=await this.authenticatedBrand(token);const campaign=this.campaigns().find(c=>c.brand_id===r.brand.id)!;
    if(this.get<ExternalBrandRecord>('brand_agent',r.brand.id)?.revoked_at)throw new Error('Agent authentication required');
    return {brand:r.brand,campaign,active:campaign.active,revoked:false};
  }
  async brandAgentOpportunities(token:string) {
    const r=await this.authenticatedBrand(token);
    if(this.get<ExternalBrandRecord>('brand_agent',r.brand.id)?.revoked_at)throw new Error('Agent authentication required');
    const opportunities=this.all<Auction>('auction').flatMap(a=>{
      const job=this.get<Job>('job',a.id),bidder=a.bidders.find(b=>b.brand.id===r.brand.id);
      if(a.status!=='running'||a.mode!=='live'||!job||job.phase!=='round'||job.deadline<=Date.now()||!bidder||bidder.finalized||bidder.withdrawn||bidder.campaign.agent_kind!=='external'||this.get('submission',`${a.id}:${job.round}:${r.brand.id}`))return [];
      const previous=a.rounds.at(-1);
      return [{auction_id:a.id,round:job.round,round_token:job.id,deadline:new Date(job.deadline).toISOString(),intent:a.intent,preferences:a.preferences,own_catalog:bidder.brand,own_fit:bidder.fit,own_campaign:{max_cpc_cents:bidder.campaign.max_cpc_cents,max_discount_cents:bidder.campaign.max_discount_cents,available_budget_cents:Math.max(0,bidder.campaign.balance_cents-bidder.campaign.reserved_cents),strategy:bidder.campaign.strategy},previous_offer:bidder.offer,public_board:previous?.offers??[],feedback:previous?.feedback??'Initial sealed round; no public offers yet.',reference_price_cents:a.reference_price_cents}];
    });
    return {brand:r.brand,opportunities};
  }
  async submitBrandAgentAction(token:string,input:Record<string,unknown>) {
    const record=await this.authenticatedBrand(token);
    if(this.get<ExternalBrandRecord>('brand_agent',record.brand.id)?.revoked_at)throw new Error('Agent authentication required');
    const id=input.auction_id;if(typeof id!=='string')throw new Error('Opportunity not available');
    const a=this.get<Auction>('auction',id),job=this.get<Job>('job',id),bidder=a?.bidders.find(b=>b.brand.id===record.brand.id);
    if(!a||!bidder||bidder.campaign.agent_kind!=='external'||bidder.withdrawn||bidder.finalized||a.mode!=='live')throw new Error('Opportunity not available');
    if(a.status!=='running'||!job||job.phase!=='round'||job.id!==input.round_token||job.round!==input.round||Date.now()>=job.deadline)throw new Error('Round is closed or stale');
    let action:AgentAction;
    try{action=validateExternalAction(input.action,bidder);}catch(e){
      this.audit(a,'agent.rejected',{reason:'Invalid action; previous committed offer remains unchanged'},{actor:record.brand.id,round:job.round,method:'POST',url:'/v1/brand-agent/actions',correlation_id:job.id,status:'rejected',http_status:400});this.put('auction',id,a);throw e;
    }
    const key=`${id}:${job.round}:${bidder.brand.id}`;
    const previous=this.get<AgentAction|string>('submission',key);
    if(previous){if(JSON.stringify(previous)===JSON.stringify(action))return {accepted:true,idempotent:true,auction_id:id,round:job.round};throw new Error('Round already has a submission');}
    // No await between ownership/deadline checks and persistence.
    this.ctx.storage.transactionSync(()=>{
      this.put('submission',key,action);
      const publicAction=action.action==='submit'?{action:action.action,bid_cents:action.bid_cents,discount_cents:action.discount_cents,final:action.final??false}:{action:action.action};
      this.audit(a,'agent.submission',{action:publicAction,validation:'pending_commit'},{actor:record.brand.id,round:job.round,method:'POST',url:'/v1/brand-agent/actions',correlation_id:job.id,status:'received',http_status:200});
      this.put('auction',id,a);
    });return {accepted:true,idempotent:false,auction_id:id,round:job.round};
  }
  private async schedule(at=Date.now()+100) {const current=await this.ctx.storage.getAlarm(); if(current===null || at<current) await this.ctx.storage.setAlarm(at);}
  async bootstrap():Promise<Bootstrap> {
    this.expireReservations();
    return {brands:this.catalog(),scenarios,campaigns:this.campaigns(),capabilities:{live_agents:!!this.env.OPENAI_API_KEY,stripe:this.mode()==='sandbox',model:this.env.OPENAI_MODEL,demo_only:true},auctions:this.all<Auction>('auction').reverse().slice(0,30),ledger:this.all<LedgerEntry>('ledger').reverse()};
  }
  async listAuctions() {return this.all<Auction>('auction').reverse().slice(0,50);}
  async readAuction(id:string) {this.expireReservations();const a=this.get<Auction>('auction',id);if(!a)throw new Error('Auction not found');return a;}
  async ledger() {return this.all<LedgerEntry>('ledger').reverse();}
  async start(input:{scenario:ScenarioId;intent:string;preferences:string[];mode:'live'|'simulation';target_score?:number;max_rounds?:number;payment_mode?:MoneyMode;request_path?:string}) {
    if(input.mode==='live'&&!this.env.OPENAI_API_KEY)throw new Error('Live GPT agents require OPENAI_API_KEY. Choose explicit simulation or configure the key.');
    if(this.all<Auction>('auction').filter(a=>!terminal(a)).length>=3) throw new Error('Finish or cancel an existing auction before starting another.');
    this.expireReservations();
    if(input.payment_mode==='sandbox'&&(input.mode!=='live'||this.mode()!=='sandbox'))throw new Error('Stripe sandbox requires live agents and configured Stripe credentials.');
    const moneyMode=input.mode==='simulation'?'simulation':input.payment_mode??this.mode();
    const a=createAuction({...input,id:crypto.randomUUID(),campaigns:this.campaigns(moneyMode),catalog:this.catalog()});
    a.payment_mode=moneyMode;
    this.audit(a,'auction.request',{scenario:a.scenario,publisher_id:a.publisher_id,intent:a.intent,preferences:a.preferences,mode:a.mode,payment_mode:moneyMode,max_rounds:a.max_rounds,target_score:a.target_score},
      {status:'accepted',...(input.request_path?{method:'POST',url:input.request_path}:{})});
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
      this.audit(a,'auction.action',{action,status:a.status,end_reason:a.end_reason,winner:a.winner},{status:'committed'});
      if(a.status==='completed')this.audit(a,'auction.completed',{winner:a.winner??null,end_reason:a.end_reason},{status:'completed'});
      if(terminal(a))this.del('job',id); // Invalidate every outstanding model response.
      this.put('auction',id,a);
    });
    await this.schedule();
    return this.get<Auction>('auction',id)!;
  }
  async updateCampaign(id:string,patch:Record<string,unknown>) {
    const c=this.get<Campaign>('campaign',id);if(!c)throw new Error('Campaign not found');
    if(patch.active===true&&c.agent_kind==='external'){
      const record=this.get<ExternalBrandRecord>('brand_agent',id)!;
      if(record.revoked_at)throw new Error('Revoked brand agent cannot be activated');
      const active=this.catalog().filter(b=>b.scenario===record.brand.scenario&&b.id!==id&&this.get<Campaign>('campaign',b.id)?.active&&this.get<Campaign>('campaign',b.id)?.agent_kind==='external');
      if(active.length>=3)throw new Error('Pilot allows three active external brands per scenario');
    }
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
      a.placement={id:crypto.randomUUID(),auction_id:a.id,publisher_id:a.publisher_id,brand_id:brand.id,offer,item:brand.item,code:brand.code,destination:brand.source_url,description:brand.description,price_kind:brand.price_kind,expires_at:new Date(Date.now()+600000).toISOString(),status:'reserved'};
      this.audit(a,'placement.reserved',{placement_id:a.placement.id,brand_id:brand.id,bid_cents:offer.bid_cents,discount_cents:offer.discount_cents,expires_at:a.placement.expires_at,payment_mode:mode},{status:'reserved'});
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
        p.status='expired';this.put('placement',p.id,p);a.placement=p;
        this.audit(a,'placement.expired',{placement_id:p.id,released_cents:p.offer.bid_cents},{status:'released'});this.put('auction',a.id,a);
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
      this.put('ledger',entry.id,entry);p.status='clicked';p.ledger_id=entry.id;this.put('placement',id,p);a.placement=p;
      this.audit(a,'placement.clicked',{placement_id:p.id,ledger_id:entry.id,brand_id:p.brand_id,publisher_id:p.publisher_id,amount_cents:amount,publisher_cents:publisher,network_cents:amount-publisher,payment_mode:mode},{actor:'transaction',status:'committed'});
      this.put('auction',a.id,a);
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
    const started=Date.now(),correlation=crypto.randomUUID();
    try {
      const destinations=JSON.parse(this.env.STRIPE_PUBLISHERS||'{}') as Record<string,string>;
      const destinationAccount=destinations[job.publisher_id];if(!destinationAccount)throw new Error(`Configure STRIPE_PUBLISHERS for ${job.publisher_id}.`);
      const a=this.get<Auction>('auction',job.auction_id);
      if(a){this.audit(a,'settlement.request',{amount_cents:job.amount,publisher_id:job.publisher_id,payment_mode:'sandbox'},{actor:'transaction',provider:'Stripe',method:'POST',url:'https://api.stripe.com/v1/transfers',correlation_id:correlation,status:'pending',redacted:['Authorization','destination','source_transaction','Idempotency-Key']});this.put('auction',a.id,a);}
      const result=await createPublisherTransfer(this.env.STRIPE_SECRET_KEY,{amountCents:job.amount,destinationAccount,sourceChargeId:job.charge_id,idempotencyKey:job.id,auctionId:job.auction_id});
      this.ctx.storage.transactionSync(()=>{
        job.status='completed';job.stripe_id=result.id;delete job.error;this.put('transfer_job',job.id,job);
        this.put('ledger',`transfer:${job.id}`,{id:`transfer:${job.id}`,kind:'transfer',created_at:iso(),brand_id:job.brand_id,publisher_id:job.publisher_id,auction_id:job.auction_id,amount_cents:job.amount,stripe_id:result.id,mode:'sandbox',status:'completed'} satisfies LedgerEntry);
        if(this.all<TransferJob>('transfer_job').filter(j=>j.ledger_id===job.ledger_id).every(j=>j.status==='completed')){const entry=this.get<LedgerEntry>('ledger',job.ledger_id)!;entry.status='completed';delete entry.error;this.put('ledger',entry.id,entry);}
        const current=this.get<Auction>('auction',job.auction_id);if(current){this.audit(current,'settlement.completed',{amount_cents:job.amount,publisher_id:job.publisher_id,transfer_id:result.id},{actor:'transaction',provider:'Stripe',correlation_id:correlation,status:'completed',duration_ms:Date.now()-started});this.put('auction',current.id,current);}
      });
    } catch(e) {
      job.attempts++;job.next_at=Date.now()+Math.min(600000,10000*2**Math.min(job.attempts,6));job.error=message(e);this.put('transfer_job',job.id,job);
      const entry=this.get<LedgerEntry>('ledger',job.ledger_id)!;entry.error=job.error;this.put('ledger',entry.id,entry);
      const current=this.get<Auction>('auction',job.auction_id);if(current){this.audit(current,'settlement.pending',{publisher_id:job.publisher_id,attempts:job.attempts,retry_at:new Date(job.next_at).toISOString()},{actor:'transaction',provider:'Stripe',correlation_id:correlation,status:'pending',duration_ms:Date.now()-started,error:'Publisher transfer is pending; see the transaction receipt.'});this.put('auction',current.id,current);}
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
        this.audit(a,'auction.failed',{reason:'assessment_failed'},{status:'failed',error:a.error});
        this.ctx.storage.transactionSync(()=>{this.put('auction',id,a);this.del('job',id);});return;
      }
      this.commitRound(id,existing);return;
    }
    const job:Job={id:crypto.randomUUID(),deadline:Date.now()+(a.status==='assessing'?20000:10000),round:a.current_round,phase:a.status==='assessing'?'assessment':'round'};
    this.ctx.storage.transactionSync(()=>{
      this.put('job',id,job);
      if(job.phase==='round'){
        a!.round_started_at=iso();a!.round_deadline=new Date(job.deadline).toISOString();
        this.audit(a!,'round.started',{deadline:a!.round_deadline,participants:a!.bidders.filter(b=>!b.finalized&&!b.withdrawn).map(b=>b.brand.id),mode:a!.mode},{correlation_id:job.id,status:'open'});this.put('auction',id,a);
        for(const b of a!.bidders.filter(b=>a!.mode==='live'&&b.campaign.agent_kind==='external'&&!b.finalized&&!b.withdrawn))this.audit(a!,'agent.opportunity',{deadline:a!.round_deadline,transport:'authenticated_poll'},{actor:b.brand.id,round:job.round,correlation_id:job.id,status:'available'});
        this.put('auction',id,a);
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
        const fits=a.mode==='live'?await assessFits(a,{apiKey:this.env.OPENAI_API_KEY,model:this.env.OPENAI_MODEL,actor:'user-agent',round:0,onTrace:event=>this.modelTrace(id,event)},AbortSignal.timeout(Math.max(1,job.deadline-Date.now()))):assessSimulatedFits(a);
        const current=this.get<Auction>('auction',id)!;
        if(terminal(current)||this.get<Job>('job',id)?.id!==job.id)return;
        if(Date.now()>job.deadline)throw new Error('Fit assessment arrived after its deadline. Retry the auction.');
        const assessed=assignFits(current,fits);
        this.audit(assessed,'fit.committed',{fits,mode:assessed.mode},{actor:'user-agent',status:'committed',round:0});
        if(assessed.pause_requested&&assessed.status==='running')assessed.status='paused';
        this.ctx.storage.transactionSync(()=>{this.put('auction',id,assessed);this.del('job',id);});
      }catch(e){
        const current=this.get<Auction>('auction',id)!;
        if(terminal(current)||this.get<Job>('job',id)?.id!==job.id)return;
        const failed=finishAuction(current,'assessment_failed');failed.error=message(e);
        this.audit(failed,'auction.failed',{reason:'assessment_failed'},{status:'failed',error:failed.error});
        this.ctx.storage.transactionSync(()=>{this.put('auction',id,failed);this.del('job',id);});
      }
    } else {
      const frozen=structuredClone(a);
      await Promise.all(frozen.bidders.filter(b=>!b.finalized&&!b.withdrawn).map(async bidder=>{
        if(frozen.mode==='live'&&bidder.campaign.agent_kind==='external')return;
        let result:AgentAction|string;
        try {
          result=frozen.mode==='live'?await decideOffer(frozen,bidder,{apiKey:this.env.OPENAI_API_KEY,model:this.env.OPENAI_MODEL,actor:bidder.brand.id,round:job.round,onTrace:event=>this.modelTrace(id,event)},AbortSignal.timeout(Math.max(1,job.deadline-Date.now()))):simulateAgentAction(frozen,bidder);
        }catch(e){result=`${Date.now()>=job.deadline?'timeout':'error'}: ${message(e)}`;}
        const current=this.get<Auction>('auction',id)!;
        if(terminal(current)||this.get<Job>('job',id)?.id!==job.id){
          current.events.push({at:iso(),kind:'ignored',message:`Late ${bidder.brand.name} response discarded; its round is no longer active.`});this.put('auction',id,current);return;
        }
        if(Date.now()>job.deadline&&typeof result!=='string')result='timeout: offer arrived after the round deadline';
        this.put('submission',`${id}:${job.round}:${bidder.brand.id}`,result);
      }));
      // Live auctions keep a full sealed round window. Persisted submissions
      // are committed by the alarm, so navigation/restarts cannot skip it.
      if(frozen.mode==='live'&&Date.now()<job.deadline){await this.schedule(job.deadline+50);return;}
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
      const round=updated.rounds.at(-1)!;
      for(const [brandId,action] of Object.entries(round.actions))this.audit(updated,'offer.validated',{action},{actor:brandId,round:round.number,correlation_id:job.id,status:typeof action==='string'?action.startsWith('timeout')?'timeout':'rejected':'accepted'});
      this.audit(updated,'round.committed',{actions:round.actions,leader_id:round.leader_id,offers:round.offers,end_reason:updated.end_reason},{round:round.number,correlation_id:job.id,status:'committed'});
      if(updated.status==='completed')this.audit(updated,'auction.completed',{winner:updated.winner??null,end_reason:updated.end_reason},{round:round.number,status:'completed'});
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
