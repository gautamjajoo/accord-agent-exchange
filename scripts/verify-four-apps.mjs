/** Exercise four deployed servers: each publisher -> shared exchange -> winning placement -> CPC ledger. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const domain='kairosity-main-website.workers.dev';
const exchange=process.env.EXCHANGE_URL||`https://accord-agent-exchange.${domain}`;
const stage=process.env.DEMO_WORKSPACE_ID||'ef5d07d4-fc2a-41d9-b0bc-e1869dfb8e7c';
const apps=[
  {id:'dating',publisher:'wavelength',origin:process.env.DATING_URL||`https://accord-dating-demo.${domain}`},
  {id:'fashion',publisher:'wardrobe',origin:process.env.SHOPPING_URL||`https://accord-shopping-demo.${domain}`},
  {id:'outings',publisher:'cityguide',origin:process.env.OUTINGS_URL||`https://accord-outings-demo.${domain}`},
];
const evidence={started_at:new Date().toISOString(),exchange,stage,applications:[],checks:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const forbidden=new Set(['bidders','campaign','campaigns','strategy','max_cpc_cents','max_discount_cents','balance_cents','reserved_cents','spent_cents','apiKey','api_key','OPENAI_API_KEY','EXCHANGE_API_KEY','PUBLISHER_API_KEY','STRIPE_SECRET_KEY','ADMIN_TOKEN']);
function sanitized(value,location='response'){
  if(Array.isArray(value)){value.forEach((item,index)=>sanitized(item,`${location}[${index}]`));return;}
  if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){assert.ok(!forbidden.has(key),`${location}.${key} leaks private exchange fields`);sanitized(child,`${location}.${key}`);}
  if(typeof value==='string')assert.ok(!/(?:sk_live_|sk_test_|sk-proj-)/.test(value),`${location} leaks a secret-looking value`);
}
async function request(origin,route,body,{stageHeader=false,status}={}){
  const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(stageHeader?{'x-demo-workspace':stage}:{}),...(body===undefined?{}:{origin})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(status!==undefined)assert.equal(response.status,status,JSON.stringify(data));else assert.ok(response.ok,`${origin}${route} ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
const publicRequest=async(app,route,body,options)=>{const data=await request(app.origin,route,body,options);sanitized(data);return data;};
const exchangeRequest=route=>request(exchange,route,undefined,{stageHeader:true});
function pass(name){evidence.checks.push(name);console.log(`PASS ${name}`);}
try{
  const bootstrap=await exchangeRequest('/api/bootstrap');assert.equal(bootstrap.presentation.workspace_id,stage);assert.equal(bootstrap.capabilities.live_agents,true);pass('exchange shared presentation stage and live model available');
  for(const app of apps){
    const context=await publicRequest(app,'/api/context');assert.equal(context.scenario.id,app.id);assert.equal(context.scenario.publisher_id,app.publisher);assert.equal(context.stage_id,stage);assert.equal(context.agent_mode,'live');assert.equal(context.exchange_url.replace(/\/$/,''),exchange.replace(/\/$/,''));
    const started=await publicRequest(app,'/api/auctions',{intent:context.scenario.prompt,preferences:context.scenario.preferences,scenario:'untrusted-override',publisher_id:'untrusted-override',mode:'simulation',max_rounds:99});
    assert.equal(started.scenario,app.id);assert.equal(started.publisher_id,app.publisher);assert.equal(started.mode,'live');assert.equal(started.max_rounds,5);assert.equal(started.payment_mode,context.payment_mode);pass(`${app.id}: separate publisher server fixes identity and requests live GPT`);
    let visible=await exchangeRequest(`/v1/auctions/${started.id}`);assert.equal(visible.id,started.id);assert.equal(visible.publisher_id,app.publisher);assert.equal(visible.intent,context.scenario.prompt);pass(`${app.id}: identical auction ID visible in exchange shared stage`);
    const deadline=Date.now()+130000;let auction=started;
    while(['assessing','running','paused'].includes(auction.status)&&Date.now()<deadline){await sleep(700);auction=await publicRequest(app,`/api/auctions/${started.id}`);}
    assert.equal(auction.status,'completed',JSON.stringify({status:auction.status,error:auction.error}));assert.ok(auction.winner&&auction.placement,`No winning funded offer: ${JSON.stringify(auction)}`);
    visible=await exchangeRequest(`/v1/auctions/${started.id}`);assert.deepEqual(auction.winner,visible.winner);assert.equal(auction.placement.id,visible.placement.id);assert.equal(auction.placement.code,visible.placement.code);assert.equal(auction.placement.publisher_id,app.publisher);assert.ok(visible.rounds.length>=1&&visible.rounds.length<=5);pass(`${app.id}: exact exchange winner and discount code returned to consumer`);
    const other=apps.find(item=>item.id!==app.id);await publicRequest(other,`/api/auctions/${started.id}`,undefined,{status:404});
    await publicRequest(other,`/api/placements/${auction.placement.id}/click`,{auction_id:auction.id},{status:404});pass(`${app.id}: another publisher cannot read or charge its placement`);
    const clicks=await Promise.all(Array.from({length:3},()=>publicRequest(app,`/api/placements/${auction.placement.id}/click`,{auction_id:auction.id})));
    assert.equal(new Set(clicks.map(click=>click.ledger.id)).size,1);const receipt=clicks[0].ledger;assert.equal(receipt.auction_id,auction.id);assert.equal(receipt.publisher_id,app.publisher);assert.equal(receipt.brand_id,auction.winner.brand_id);assert.equal(receipt.amount_cents,auction.winner.bid_cents);assert.equal(receipt.publisher_cents,Math.floor(receipt.amount_cents*4/5));assert.equal(receipt.publisher_cents+receipt.network_cents,receipt.amount_cents);assert.equal(receipt.mode,auction.payment_mode);assert.equal(clicks[0].destination,auction.placement.destination);
    const entries=await exchangeRequest('/v1/ledger');const charges=entries.filter(entry=>entry.auction_id===auction.id&&entry.kind==='click');assert.equal(charges.length,1);assert.equal(charges[0].id,receipt.id);assert.equal((await exchangeRequest(`/v1/auctions/${auction.id}`)).placement.status,'clicked');pass(`${app.id}: three simultaneous consumer clicks make one attributed 80/20 exchange charge`);
    evidence.applications.push({scenario:app.id,publisher:app.publisher,consumer_url:app.origin,auction_id:auction.id,model:bootstrap.capabilities.model,agent_mode:auction.mode,payment_mode:auction.payment_mode,rounds:visible.rounds.length,end_reason:auction.end_reason,winner:auction.winner.brand_name,placement_id:auction.placement.id,discount_code:auction.placement.code,bid_cents:receipt.amount_cents,discount_cents:auction.winner.discount_cents,publisher_cents:receipt.publisher_cents,network_cents:receipt.network_cents,ledger_id:receipt.id,status:receipt.status});
  }
  pass('consumer API payloads contain no model keys or private campaigns');evidence.passed=true;
}catch(error){evidence.passed=false;evidence.error=error.stack||String(error);console.error(evidence.error);process.exitCode=1;}
finally{
  evidence.completed_at=new Date().toISOString();await fs.mkdir(path.join(root,'test-results'),{recursive:true});await fs.writeFile(path.join(root,'test-results/four-app-verification.json'),JSON.stringify(evidence,null,2)+'\n');
  const rows=evidence.applications.map(a=>`| ${a.scenario} | ${a.publisher} | ${a.auction_id} | ${a.winner} | ${a.rounds} | $${(a.bid_cents/100).toFixed(2)} | $${(a.publisher_cents/100).toFixed(2)} | ${a.payment_mode} |`).join('\n');
  const report=`# Four-server integration verification\n\n${evidence.passed?'PASS':'INCOMPLETE'} — ${evidence.completed_at}\n\nThis checks real HTTP calls through three independently deployed consumer Workers into the separate Accord exchange. All agent decisions use ${evidence.applications[0]?.model||'the configured GPT model'}. Payment mode is reported explicitly; simulated receipts do not establish Stripe transfer completion.\n\nExchange: ${exchange}\n\nShared presentation workspace: \`${stage}\`\n\n| Consumer | Publisher | Exact auction ID on both servers | Winner | Rounds | CPC | Publisher credit | Money mode |\n|---|---|---|---|---:|---:|---:|---|\n${rows}\n\n## Checks\n\n${evidence.checks.map(check=>'- '+check).join('\n')}\n\n${evidence.error?'## Failure\n\n```\n'+evidence.error+'\n```\n\n':''}## Reproduce\n\nRun with Node 22 or newer after deployment and secret setup:\n\n\`\`\`sh\nnode scripts/verify-four-apps.mjs\n\`\`\`\n\nOverride origins with EXCHANGE_URL, DATING_URL, SHOPPING_URL, OUTINGS_URL if needed. Machine-readable evidence: \`test-results/four-app-verification.json\`. This verifier makes live GPT requests and three idempotent click requests per winning placement.\n`;
  await fs.mkdir(path.join(root,'docs'),{recursive:true});await fs.writeFile(path.join(root,'docs/FOUR-APP-VERIFICATION.md'),report);console.log(`Evidence written; passed=${evidence.passed}`);
}
