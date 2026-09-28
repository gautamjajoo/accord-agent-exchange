import { brands, scenarios } from './catalog';
import type { AgentAction, AgentMode, Auction, Bidder, Brand, Campaign, EndReason, Fit, RankedOffer, ScenarioId } from './types';

const terminal = (a:Auction) => ['completed','cancelled','failed'].includes(a.status);
const time = (now?:string|number|Date) => new Date(now ?? Date.now()).toISOString();
const clone = <T>(value:T):T => structuredClone(value);

export function createAuction(input:{id:string;scenario:ScenarioId;intent:string;preferences:string[];mode:AgentMode;campaigns:Campaign[];catalog?:Brand[];now?:string|number|Date;target_score?:number;max_rounds?:number}):Auction {
  const scenario = scenarios.find(s => s.id === input.scenario);
  if (!scenario) throw new Error('Unknown scenario');
  const max = input.max_rounds ?? 5, target = input.target_score ?? 85;
  if (!Number.isInteger(max) || max < 1 || max > 5) throw new Error('max_rounds must be an integer from 1 to 5');
  if (!Number.isFinite(target) || target < 0 || target > 100) throw new Error('target_score must be from 0 to 100');
  const selected = (input.catalog??brands).filter(b => b.scenario===scenario.id).flatMap(brand => {
    const campaign = input.campaigns.find(c => c.brand_id === brand.id && c.active);
    return campaign ? [{brand:clone(brand),campaign:clone(campaign),fit:{brand_id:brand.id,score:0,explanation:'Awaiting user-agent assessment.'},offer:null,finalized:false,withdrawn:false,last_action:'waiting',explanation:'Waiting for the auction to begin.'} satisfies Bidder] : [];
  });
  const at = time(input.now);
  return {id:input.id,scenario:scenario.id,publisher_id:scenario.publisher_id,intent:input.intent,preferences:clone(input.preferences),mode:input.mode,status:'assessing',created_at:at,updated_at:at,reference_price_cents:Math.max(1,...selected.map(b=>b.brand.base_price_cents)),target_score:target,max_rounds:max,bidders:selected,rounds:[],current_round:0,pause_requested:false,events:[{at,message:'Opportunity received. Assessing fit before seeing bids.',kind:'created'}]};
}

export function assignFits(input:Auction, fits:Fit[], now?:string|number|Date):Auction {
  const a = clone(input);
  if (a.status !== 'assessing') return a;
  if (fits.length !== a.bidders.length || new Set(fits.map(f=>f.brand_id)).size !== fits.length) throw new Error('Fit assessment must cover each bidder exactly once');
  for (const bidder of a.bidders) {
    const fit = fits.find(f=>f.brand_id===bidder.brand.id);
    if (!fit || !Number.isFinite(fit.score) || fit.score < 0 || fit.score > 100 || typeof fit.explanation !== 'string') throw new Error('Invalid fit assessment');
    bidder.fit = clone(fit);
  }
  a.updated_at = time(now); a.status = 'running'; a.current_round = 1;
  a.events.push({at:a.updated_at,message:'Personal fit frozen. The first sealed offer round can begin.',kind:'assessed'});
  return a.bidders.length ? a : finishAuction(a,'no_offers',now);
}

export function rankOffers(a:Auction):RankedOffer[] {
  return a.bidders.filter(b=>b.offer && !b.withdrawn).map(b=>{
    const offer = b.offer!;
    const effective = b.brand.base_price_cents - offer.discount_cents;
    const price = 100 * (1 - effective / a.reference_price_cents);
    return { ...offer,brand_id:b.brand.id,brand_name:b.brand.name,base_price_cents:b.brand.base_price_cents,effective_price_cents:effective,fit_score:b.fit.score,price_score:price,user_score:0.6*b.fit.score+0.4*price,finalized:b.finalized };
  }).sort((a,b)=>b.user_score-a.user_score || b.bid_cents-a.bid_cents || (a.brand_id < b.brand_id ? -1 : a.brand_id > b.brand_id ? 1 : 0));
}

function offerError(b:Bidder, action:AgentAction):string|undefined {
  if (action.action !== 'submit') return;
  if (!Number.isSafeInteger(action.bid_cents) || action.bid_cents <= 0) return 'CPC must be a positive integer number of cents.';
  if (!Number.isSafeInteger(action.discount_cents) || action.discount_cents < 0) return 'Discount must be a nonnegative integer number of cents.';
  if (action.bid_cents > b.campaign.max_cpc_cents) return 'CPC exceeds the frozen campaign limit.';
  if (action.bid_cents > b.campaign.balance_cents - b.campaign.reserved_cents) return 'CPC exceeds the campaign budget snapshot.';
  if (action.discount_cents > Math.min(b.campaign.max_discount_cents,b.brand.base_price_cents)) return 'Discount exceeds the campaign limit or item price.';
  if (b.offer && (action.bid_cents < b.offer.bid_cents || action.discount_cents < b.offer.discount_cents)) return 'Revisions cannot reduce the CPC or discount.';
}

/** Apply one complete sealed round. Partial submissions must stay in the runner, never here. */
export function applyRound(input:Auction, actions:Record<string,AgentAction|string>, now?:string|number|Date):Auction {
  const a = clone(input), at = time(now);
  if (a.status !== 'running') return a;
  if (a.rounds.length >= a.max_rounds) return finishAuction(a,'max_rounds',now);
  const before = JSON.stringify(a.bidders.map(b=>[b.brand.id,b.offer,b.finalized,b.withdrawn]));
  const recorded:Record<string,AgentAction|string> = {};
  for (const b of a.bidders) {
    if (b.finalized || b.withdrawn) {
      if (actions[b.brand.id]) a.events.push({at,kind:'ignored',message:`Ignored late action from ${b.brand.name}, whose participation is closed.`});
      continue;
    }
    const raw = actions[b.brand.id];
    if (!raw || typeof raw === 'string') {
      const message = typeof raw === 'string' ? raw : 'timeout: no submission before the round deadline';
      recorded[b.brand.id] = message; b.last_action = message.toLowerCase().includes('timeout') ? 'timeout' : 'error'; b.error = message;
      b.explanation = b.offer ? 'Previous committed offer retained.' : 'No valid offer this round.'; continue;
    }
    const action = raw as AgentAction;
    const error = !['submit','hold','finalize','withdraw'].includes(action.action) || typeof action.explanation !== 'string' ? 'Invalid agent action.' : offerError(b,action);
    if (error || ((action.action === 'hold' || action.action === 'finalize') && !b.offer)) {
      const message = error ?? 'Cannot hold or finalize without a previous offer.';
      recorded[b.brand.id] = `error: ${message}`; b.last_action='error'; b.error=message; b.explanation='Previous committed offer retained.'; continue;
    }
    recorded[b.brand.id] = clone(action); delete b.error;
    b.last_action = action.action; b.explanation = action.explanation;
    if (action.action === 'withdraw') b.withdrawn = true;
    if (action.action === 'finalize') b.finalized = true;
    if (action.action === 'submit') { b.offer={bid_cents:action.bid_cents,discount_cents:action.discount_cents}; if(action.final) b.finalized=true; }
  }
  const changed = before !== JSON.stringify(a.bidders.map(b=>[b.brand.id,b.offer,b.finalized,b.withdrawn]));
  const ranked = rankOffers(a), leader = ranked[0];
  const cash = [...ranked].sort((x,y)=>y.bid_cents-x.bid_cents || x.brand_id.localeCompare(y.brand_id))[0];
  const number = a.rounds.length+1;
  a.rounds.push({number,started_at:a.round_started_at??at,completed_at:at,offers:ranked,actions:recorded,leader_id:leader?.brand_id??null,cash_leader_id:cash?.brand_id??null,feedback:leader ? `${leader.brand_name} leads on user value at ${leader.user_score.toFixed(1)}/100, with an effective price of $${(leader.effective_price_cents/100).toFixed(2)}. Compete with better customer value; cash only breaks exact score ties.` : 'No valid offers remain.',changed});
  a.current_round=number; a.updated_at=at; delete a.round_started_at; delete a.round_deadline;
  a.events.push({at,kind:'round',message:`Round ${number} sealed. ${leader ? `${leader.brand_name} leads.` : 'No offers.'}`});
  if (!leader) return finishAuction(a,'no_offers',now);
  if (leader.user_score >= a.target_score) return finishAuction(a,'target_reached',now);
  if (a.bidders.filter(b=>!b.withdrawn).every(b=>b.finalized)) return finishAuction(a,'all_final',now);
  if (number > 1 && !changed) return finishAuction(a,'no_change',now);
  if (number >= a.max_rounds) return finishAuction(a,'max_rounds',now);
  a.current_round=number+1;
  if (a.pause_requested) a.status='paused';
  return a;
}

export function finishAuction(input:Auction, reason:EndReason, now?:string|number|Date):Auction {
  const a = clone(input);
  if (terminal(a)) return a;
  if (reason === 'user_accepted' && !a.rounds.length) throw new Error('Wait for the first completed round before accepting.');
  a.updated_at=time(now); a.end_reason=reason; a.current_round=a.rounds.length;
  a.status=reason==='cancelled'?'cancelled':reason==='assessment_failed'?'failed':'completed';
  delete a.round_started_at; delete a.round_deadline;
  if (!['cancelled','assessment_failed','no_offers','insufficient_funds'].includes(reason)) a.winner = clone(a.rounds.at(-1)?.offers[0]);
  else delete a.winner;
  a.events.push({at:a.updated_at,kind:'ended',message:`Auction ended: ${reason.replaceAll('_',' ')}.`});
  return a;
}

/** Deliberately simple, disclosed simulation. Production/live assessment uses the model provider. */
export function assessSimulatedFits(a:Auction):Fit[] {
  const text = `${a.intent} ${a.preferences.join(' ')}`.toLowerCase();
  return a.bidders.map(b=>{
    const matches=b.brand.tags.filter(tag=>text.includes(tag));
    let score=Math.min(96,78+matches.length*3);
    if ((text.includes('clean') || text.includes('wash')) && b.brand.tags.includes('leather')) score-=24;
    return {brand_id:b.brand.id,score,explanation:matches.length ? `Simulation: catalog matches ${matches.join(', ')}. Availability is not verified.` : 'Simulation: category fit from the curated catalog; no specific preference match.'};
  });
}

/** Adaptive policy simulator for rehearsals; no brand identity or round schedule decides the winner. */
export function simulateAgentAction(a:Auction, b:Bidder):AgentAction {
  const strategy=b.campaign.strategy.toLowerCase();
  const premium=strategy.startsWith('premium'), flexible=strategy.startsWith('flexible');
  const maxBid=Math.min(b.campaign.max_cpc_cents,b.campaign.balance_cents-b.campaign.reserved_cents);
  const cap=Math.min(b.campaign.max_discount_cents,b.brand.base_price_cents);
  if (maxBid < 1) return {action:'withdraw',explanation:'Simulation: insufficient advertising balance for a positive CPC.'};
  if (!b.offer) return {action:'submit',bid_cents:Math.max(1,Math.floor(maxBid*(premium?0.9:0.72))),discount_cents:Math.min(cap,Math.round(b.brand.base_price_cents*(premium?0.06:flexible?0:0.015))),explanation:'Simulation: opening offer follows our configured strategy and spending limits.'};
  const leader=rankOffers(a)[0];
  if (leader?.brand_id===b.brand.id) return {action:'hold',explanation:'Simulation: currently leading on user value; holding the offer.'};
  if (b.offer.discount_cents >= cap) return {action:'finalize',explanation:'Simulation: at the authorized discount ceiling; these are our final terms.'};
  const myScore=0.6*b.fit.score+40*(1-(b.brand.base_price_cents-b.offer.discount_cents)/a.reference_price_cents);
  const needed=Math.ceil(Math.max(0,(leader?.user_score??myScore)-myScore)*a.reference_price_cents/40)+Math.max(1,Math.round(b.brand.base_price_cents*0.02));
  const step=Math.max(1,Math.round(cap*(premium?0.25:flexible?0.6:0.4)));
  const discount=Math.min(cap,b.offer.discount_cents+Math.min(needed,step));
  return {action:'submit',bid_cents:b.offer.bid_cents,discount_cents:discount,final:discount===cap,explanation:`Simulation: improve customer value to compete with the previous leader, within the configured discount ceiling. The CPC stays unchanged.`};
}
