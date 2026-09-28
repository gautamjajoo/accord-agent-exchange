/** Verify the real HTTP API; never substitutes a model or a Stripe response. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const origin=process.env.DEMO_ORIGIN||'http://127.0.0.1:8787';
let cookie='';
const evidence={origin,started_at:new Date().toISOString(),checks:[],auctions:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,data,method=data===undefined?'GET':'POST'){
  const response=await fetch(origin+route,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...(process.env.ADMIN_TOKEN?{'x-admin-token':process.env.ADMIN_TOKEN}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
  const result=await response.json();assert.ok(response.ok,`${method} ${route}: ${response.status} ${JSON.stringify(result)}`);return result;
}
function pass(name,details={}){evidence.checks.push({name,passed:true,...details});console.log(`PASS ${name}`);}
async function until(id,predicate,timeout=110000){
  const deadline=Date.now()+timeout;let value;
  while(Date.now()<deadline){value=await api(`/v1/auctions/${id}`);if(predicate(value))return value;await wait(300);}
  throw new Error(`Auction ${id} timed out: ${JSON.stringify({status:value?.status,rounds:value?.rounds.length,error:value?.error})}`);
}
const terminal=a=>['completed','failed','cancelled'].includes(a.status);
const create=(scenario,mode='simulation',extra={})=>api(`/api/demo/${scenario.id}/auctions`,{intent:scenario.prompt,preferences:scenario.preferences,mode,target_score:100,max_rounds:5,...extra});
function inspect(a,scenario){
  assert.equal(a.status,'completed');assert.equal(a.publisher_id,scenario.publisher_id);assert.ok(a.rounds.length>=1&&a.rounds.length<=5);assert.ok(a.winner);assert.ok(a.placement);assert.equal(a.placement.publisher_id,scenario.publisher_id);
  assert.equal(a.reference_price_cents,Math.max(...a.bidders.map(b=>b.brand.base_price_cents)));
  for(const round of a.rounds)for(const offer of round.offers){
    assert.equal(offer.fit_score,a.bidders.find(b=>b.brand.id===offer.brand_id).fit.score);
    assert.ok(Math.abs(offer.price_score-100*(1-offer.effective_price_cents/a.reference_price_cents))<0.00001);
    assert.ok(Math.abs(offer.user_score-(.6*offer.fit_score+.4*offer.price_score))<0.00001);
  }
  evidence.auctions.push({id:a.id,scenario:a.scenario,mode:a.mode,payment_mode:a.payment_mode,rounds:a.rounds.length,reason:a.end_reason,winner:a.winner.brand_id});
}
try{
  const bootstrap=await api('/api/bootstrap');assert.equal(bootstrap.scenarios.length,3);assert.equal(bootstrap.brands.length,9);pass('three scenario adapters and nine brand templates');
  let signature=false;
  for(const scenario of bootstrap.scenarios){
    const started=await create(scenario);const done=await until(started.id,terminal);inspect(done,scenario);
    pass(`${scenario.id}: completed common exchange with frozen fit and price reference`,{rounds:done.rounds.length,publisher:done.publisher_id});
    const final=done.rounds.at(-1);const cashMax=Math.max(...final.offers.map(o=>o.bid_cents));
    if(done.winner.bid_cents<cashMax){signature=true;pass(`${scenario.id}: lower cash bidder wins on user value`,{winner_bid:done.winner.bid_cents,cash_max:cashMax});}
    const clicks=await Promise.all(Array.from({length:5},()=>api(`/v1/placements/${done.placement.id}/click`,{})));
    assert.equal(new Set(clicks.map(c=>c.ledger.id)).size,1);const entry=clicks[0].ledger;
    assert.equal(entry.amount_cents,done.winner.bid_cents);assert.equal(entry.publisher_cents,Math.floor(entry.amount_cents*.8));assert.equal(entry.publisher_cents+entry.network_cents,entry.amount_cents);assert.equal(entry.publisher_id,scenario.publisher_id);
    const ledger=await api('/v1/ledger');assert.equal(ledger.filter(l=>l.kind==='click'&&l.auction_id===done.id).length,1);pass(`${scenario.id}: five simultaneous clicks commit one charge and one 80/20 split`);
  }
  assert.ok(signature,'At least one real simulated-agent negotiation must demonstrate the signature lower-CPC winner');
  const scenario=bootstrap.scenarios[0];
  const started=await create(scenario);await api(`/v1/auctions/${started.id}/actions`,{action:'pause'});
  const paused=await until(started.id,a=>a.status==='paused');assert.equal(paused.rounds.length,0);
  await wait(1400);assert.equal((await api(`/v1/auctions/${started.id}`)).rounds.length,0);pass('pause before first round remains paused');
  await api(`/v1/auctions/${started.id}/actions`,{action:'continue'});
  await until(started.id,a=>a.rounds.length>=1);
  const pausedAgain=await api(`/v1/auctions/${started.id}/actions`,{action:'pause'});
  const frozen=pausedAgain.status==='paused'?pausedAgain:await until(started.id,a=>a.status==='paused');
  const accepted=await api(`/v1/auctions/${started.id}/actions`,{action:'accept'});assert.equal(accepted.end_reason,'user_accepted');assert.deepEqual(accepted.rounds,frozen.rounds);assert.equal(accepted.winner.brand_id,frozen.rounds.at(-1).leader_id);
  await wait(1600);assert.deepEqual((await api(`/v1/auctions/${started.id}`)).rounds,accepted.rounds);pass('accept locks last completed round and prevents further negotiation');
  const cancelled=await create(scenario);const cancelledNow=await api(`/v1/auctions/${cancelled.id}/actions`,{action:'cancel'});assert.equal(cancelledNow.status,'cancelled');assert.equal(cancelledNow.winner,undefined);await wait(1600);assert.equal((await api(`/v1/auctions/${cancelled.id}`)).status,'cancelled');pass('cancel survives runner wakeup without selecting a winner');
  if(bootstrap.capabilities.live_agents&&process.env.SKIP_LIVE!=='1'){
    const live=await create(scenario,'live');const done=await until(live.id,terminal,150000);inspect(done,scenario);assert.equal(done.mode,'live');
    await fs.mkdir(path.join(root,'examples'),{recursive:true});await fs.writeFile(path.join(root,'examples/live-auction.json'),JSON.stringify({label:'Recorded live GPT auction; read-only replay',recorded_at:new Date().toISOString(),model:bootstrap.capabilities.model,auction:done},null,2)+'\n');
    pass('real GPT fit and brand decisions complete; live replay recorded',{rounds:done.rounds.length,model:bootstrap.capabilities.model,payment_mode:done.payment_mode});
  }
  evidence.passed=true;
}catch(error){evidence.passed=false;evidence.error=error.stack||String(error);console.error(evidence.error);process.exitCode=1;}
finally{evidence.completed_at=new Date().toISOString();await fs.mkdir(path.join(root,'test-results'),{recursive:true});await fs.writeFile(path.join(root,'test-results/http-verification.json'),JSON.stringify(evidence,null,2)+'\n');console.log(`Evidence: ${path.join(root,'test-results/http-verification.json')}`);}
