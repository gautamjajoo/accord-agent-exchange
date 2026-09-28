import { describe, expect, it } from 'vitest';
import { applyRound, assessSimulatedFits, assignFits, createAuction, finishAuction, rankOffers, simulateAgentAction } from '../src/shared/engine';
import { brands, createCampaigns, scenarios } from '../src/shared/catalog';
import type { AgentAction, Auction, Campaign } from '../src/shared/types';

const NOW='2026-09-28T20:00:00.000Z';
const submit=(bid_cents:number,discount_cents:number,final=false):AgentAction=>({action:'submit',bid_cents,discount_cents,explanation:'Test policy.',final});
function fresh(options:{max_rounds?:number; target_score?:number; campaigns?:Campaign[]}={}):Auction {
  const a=createAuction({id:'test',scenario:'dating',intent:'Coffee for two',preferences:['Casual'],mode:'simulation',campaigns:options.campaigns??createCampaigns(),now:NOW,target_score:options.target_score??100,max_rounds:options.max_rounds});
  return assignFits(a,a.bidders.map(b=>({brand_id:b.brand.id,score:80,explanation:'Equal fit.'})),NOW);
}
function opening(a=fresh()):Auction {
  return applyRound(a,{'blue-bottle':submit(150,100),sightglass:submit(100,0),ritual:submit(120,0)},NOW);
}
const hold:AgentAction={action:'hold',explanation:'Hold.'};
const final:AgentAction={action:'finalize',explanation:'Final.'};
const withdraw:AgentAction={action:'withdraw',explanation:'Withdraw.'};

 describe('user-value auction',()=>{
  it('lets a lower cash bidder take the lead with a customer discount',()=>{
    const r1=opening(); expect(rankOffers(r1)[0].brand_id).toBe('blue-bottle');
    const r2=applyRound(r1,{'blue-bottle':hold,sightglass:submit(100,400),ritual:hold},NOW);
    expect(rankOffers(r2)[0].brand_id).toBe('sightglass');
    expect(r2.rounds[1].cash_leader_id).toBe('blue-bottle');
    expect(rankOffers(r2)[0].bid_cents).toBeLessThan(150);
    expect(rankOffers(r2)[0].effective_price_cents).toBe(1200);
  });
  it('does not let cash overrule a higher user score',()=>{
    const a=applyRound(fresh(),{'blue-bottle':submit(180,0),sightglass:submit(1,400),ritual:submit(140,0)},NOW);
    expect(rankOffers(a)[0].brand_id).toBe('sightglass');
  });
  it('uses cash then stable identity only for exact score ties',()=>{
    let a=applyRound(fresh(),{'blue-bottle':submit(100,0),sightglass:submit(110,0),ritual:submit(100,0)},NOW);
    expect(rankOffers(a)[0].brand_id).toBe('sightglass');
    a=applyRound(fresh(),{'blue-bottle':submit(100,0),sightglass:submit(100,0),ritual:submit(100,0)},NOW);
    expect(rankOffers(a).map(o=>o.brand_id)).toEqual(['blue-bottle','ritual','sightglass']);
  });
  it('keeps fit, reference price and campaign snapshots unchanged',()=>{
    const campaigns=createCampaigns(), a=fresh({campaigns});
    campaigns[0].max_cpc_cents=9999;
    expect(a.bidders[0].campaign.max_cpc_cents).toBe(180);
    const r1=opening(a), r2=applyRound(r1,{'blue-bottle':withdraw,sightglass:submit(100,400),ritual:hold},NOW);
    expect(r2.reference_price_cents).toBe(a.reference_price_cents);
    expect(r2.bidders.map(b=>b.fit)).toEqual(a.bidders.map(b=>b.fit));
    expect(assignFits(r2,[],NOW)).toEqual(r2);
  });
  it('clones input state including action history',()=>{
    const a=fresh(), copy=structuredClone(a), actions={'blue-bottle':submit(100,0),sightglass:submit(100,0),ritual:submit(100,0)};
    const result=applyRound(a,actions,NOW);
    expect(a).toEqual(copy);
    actions['blue-bottle'].explanation='Mutated externally';
    expect(result.rounds[0].actions['blue-bottle']).not.toEqual(actions['blue-bottle']);
  });
});

describe('round state machine',()=>{
  it('caps negotiation at five total rounds including initial offers',()=>{
    let a=fresh();
    for (let n=1;n<=5;n++) a=applyRound(a,{'blue-bottle':submit(100,n*10),sightglass:submit(100,n*10),ritual:submit(100,n*10)},NOW);
    expect(a.rounds).toHaveLength(5); expect(a.end_reason).toBe('max_rounds'); expect(a.current_round).toBe(5);
    expect(applyRound(a,{'blue-bottle':submit(110,100)},NOW).rounds).toHaveLength(5);
  });
  it('honors a smaller configured round limit',()=>{
    const a=opening(fresh({max_rounds:1})); expect(a.end_reason).toBe('max_rounds'); expect(a.rounds).toHaveLength(1);
  });
  it('rejects invalid round and target settings',()=>{
    for(const max_rounds of [0,6,1.5]) expect(()=>fresh({max_rounds})).toThrow();
    for(const target_score of [-1,101,NaN]) expect(()=>fresh({target_score})).toThrow();
  });
  it('accepts only a completed round and discards later proposals',()=>{
    expect(()=>finishAuction(fresh(),'user_accepted',NOW)).toThrow();
    const a=opening(); a.round_started_at=NOW; a.round_deadline='2026-09-28T20:00:10.000Z';
    const accepted=finishAuction(a,'user_accepted',NOW);
    expect(accepted.winner?.brand_id).toBe('blue-bottle'); expect(accepted.current_round).toBe(1); expect(accepted.round_deadline).toBeUndefined();
    expect(applyRound(accepted,{sightglass:submit(100,650)},NOW).winner).toEqual(accepted.winner);
  });
  it('cancels without choosing a winner',()=>{
    const a=finishAuction(opening(),'cancelled',NOW); expect(a.status).toBe('cancelled'); expect(a.winner).toBeUndefined();
  });
  it('retains finalized offers but ignores later attempts to change them',()=>{
    const a=applyRound(fresh(),{'blue-bottle':submit(150,100,true),sightglass:submit(100,0),ritual:submit(100,0)},NOW);
    const b=applyRound(a,{'blue-bottle':withdraw,sightglass:submit(100,50),ritual:hold},NOW);
    expect(b.bidders[0].withdrawn).toBe(false); expect(b.bidders[0].offer?.discount_cents).toBe(100);
    expect(rankOffers(b).some(o=>o.brand_id==='blue-bottle')).toBe(true);
    expect(b.events.some(e=>e.kind==='ignored')).toBe(true);
  });
  it('prevents a withdrawn bidder from winning or rejoining',()=>{
    const a=applyRound(opening(),{'blue-bottle':withdraw,sightglass:submit(100,100),ritual:hold},NOW);
    const b=applyRound(a,{'blue-bottle':submit(180,200),sightglass:submit(100,200),ritual:hold},NOW);
    expect(rankOffers(b).some(o=>o.brand_id==='blue-bottle')).toBe(false);
  });
  it('ends when all participants finalize',()=>{
    const a=applyRound(opening(),{'blue-bottle':final,sightglass:final,ritual:final},NOW); expect(a.end_reason).toBe('all_final');
  });
  it('ends when a complete revision round changes nothing',()=>{
    const a=applyRound(opening(),{'blue-bottle':hold,sightglass:hold,ritual:hold},NOW); expect(a.end_reason).toBe('no_change'); expect(a.rounds).toHaveLength(2);
  });
  it('ends without a result if every bidder withdraws',()=>{
    const a=applyRound(opening(),{'blue-bottle':withdraw,sightglass:withdraw,ritual:withdraw},NOW); expect(a.end_reason).toBe('no_offers'); expect(a.winner).toBeUndefined();
  });
  it('ends with no result when the first round has no valid offers',()=>{
    const a=applyRound(fresh(),{},NOW); expect(a.end_reason).toBe('no_offers'); expect(a.bidders.every(b=>b.last_action==='timeout')).toBe(true);
  });
  it('accepts when the leader meets the configured satisfaction threshold',()=>{
    const a=opening(fresh({target_score:50})); expect(a.end_reason).toBe('target_reached'); expect(a.winner?.user_score).toBeGreaterThanOrEqual(50);
  });
  it('pauses only after a round is committed',()=>{
    const a=fresh(); a.pause_requested=true;
    const b=opening(a); expect(b.status).toBe('paused'); expect(b.rounds).toHaveLength(1);
    expect(applyRound(b,{},NOW)).toEqual(b);
  });
});

describe('offer validation and failure handling',()=>{
  it.each([
    [0,0],[-1,0],[1.5,0],[181,0],[100,-1],[100,1.2],[100,201],[100,Infinity],[NaN,0],
  ])('rejects invalid offer %s, %s without replacing previous terms',(bid,discount)=>{
    const a=opening();
    const b=applyRound(a,{'blue-bottle':submit(bid,discount),sightglass:submit(100,10),ritual:hold},NOW);
    expect(b.bidders[0].offer).toEqual(a.bidders[0].offer); expect(b.bidders[0].last_action).toBe('error');
  });
  it('rejects decreasing either CPC or discount',()=>{
    for (const offer of [submit(149,150),submit(150,99)]) {
      const a=applyRound(opening(),{'blue-bottle':offer,sightglass:submit(100,10),ritual:hold},NOW);
      expect(a.bidders[0].offer).toEqual({bid_cents:150,discount_cents:100});
    }
  });
  it('rejects discounts beyond the actual base price',()=>{
    const campaigns=createCampaigns(); campaigns[0].max_discount_cents=9999;
    const a=applyRound(fresh({campaigns}),{'blue-bottle':submit(100,1601),sightglass:submit(100,0),ritual:submit(100,0)},NOW);
    expect(a.bidders[0].offer).toBeNull();
  });
  it('retains previous valid offers after timeout or model failure',()=>{
    const a=opening();
    const b=applyRound(a,{'blue-bottle':'timeout','sightglass':'provider unavailable',ritual:submit(120,10)},NOW);
    expect(b.bidders[0].offer).toEqual(a.bidders[0].offer); expect(b.bidders[1].offer).toEqual(a.bidders[1].offer);
    expect(b.bidders[0].last_action).toBe('timeout'); expect(b.bidders[1].last_action).toBe('error');
  });
  it('requires a complete, unique finite fit assessment',()=>{
    const a=createAuction({id:'a',scenario:'dating',intent:'Coffee',preferences:[],mode:'live',campaigns:createCampaigns(),now:NOW});
    expect(()=>assignFits(a,[],NOW)).toThrow();
    const fits=a.bidders.map(b=>({brand_id:b.brand.id,score:80,explanation:'Grounded.'}));
    fits[0].score=NaN; expect(()=>assignFits(a,fits,NOW)).toThrow();
    fits[0].score=80; fits[0].brand_id=fits[1].brand_id; expect(()=>assignFits(a,fits,NOW)).toThrow();
  });
});

describe('shared scenarios and disclosed simulation',()=>{
  it('uses nine source-backed brands, three disjoint scenarios and distinct publishers',()=>{
    expect(brands).toHaveLength(9); expect(scenarios).toHaveLength(3);
    expect(new Set(scenarios.map(s=>s.publisher_id)).size).toBe(3);
    for (const scenario of scenarios) {
      const a=createAuction({id:scenario.id,scenario:scenario.id,intent:scenario.prompt,preferences:scenario.preferences,mode:'simulation',campaigns:createCampaigns(),now:NOW});
      expect(a.publisher_id).toBe(scenario.publisher_id); expect(a.bidders).toHaveLength(3);
      expect(a.bidders.every(b=>b.brand.source_url.startsWith('https://'))).toBe(true);
    }
  });
  it('changes simulated fit from supplied preferences rather than bids',()=>{
    const a=createAuction({id:'a',scenario:'dating',intent:'Meet by the waterfront',preferences:[],mode:'simulation',campaigns:createCampaigns(),now:NOW});
    const fits=assessSimulatedFits(a); expect(fits.find(f=>f.brand_id==='blue-bottle')!.score).toBeGreaterThan(fits.find(f=>f.brand_id==='sightglass')!.score);
  });
  it('demonstrates a lower cash bidder winning the default coffee rehearsal through negotiation',()=>{
    const scenario=scenarios.find(s=>s.id==='dating')!;
    let a=createAuction({id:'signature',scenario:scenario.id,intent:scenario.prompt,preferences:scenario.preferences,mode:'simulation',campaigns:createCampaigns(),now:NOW});
    a=assignFits(a,assessSimulatedFits(a),NOW);
    while(a.status==='running') a=applyRound(a,Object.fromEntries(a.bidders.filter(b=>!b.finalized&&!b.withdrawn).map(b=>[b.brand.id,simulateAgentAction(a,b)])),NOW);
    expect(a.rounds[0].leader_id).not.toBe(a.winner!.brand_id);
    const cashLeader=[...a.rounds.at(-1)!.offers].sort((x,y)=>y.bid_cents-x.bid_cents)[0];
    expect(a.winner!.bid_cents).toBeLessThan(cashLeader.bid_cents);
    expect(a.winner!.user_score).toBeGreaterThan(cashLeader.user_score);
  });
  it('runs adaptive simulation to a valid terminal state without mutating private limits',()=>{
    for (const scenario of scenarios) {
      let a=createAuction({id:scenario.id,scenario:scenario.id,intent:scenario.prompt,preferences:scenario.preferences,mode:'simulation',campaigns:createCampaigns(),now:NOW});
      a=assignFits(a,assessSimulatedFits(a),NOW);
      for(let i=0;i<5&&a.status==='running';i++) {
        const actions=Object.fromEntries(a.bidders.filter(b=>!b.finalized&&!b.withdrawn).map(b=>[b.brand.id,simulateAgentAction(a,b)]));
        a=applyRound(a,actions,NOW);
      }
      expect(a.status).toBe('completed'); expect(a.rounds.length).toBeLessThanOrEqual(5);
      expect(a.bidders.every(b=>!b.error)).toBe(true); expect(a.winner).toBeDefined();
    }
  });
});
