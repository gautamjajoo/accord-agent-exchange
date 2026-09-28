/** Read-only deployment regression: four origins, asset integrity and API wiring. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const domain='kairosity-main-website.workers.dev';
const exchange=process.env.EXCHANGE_URL||`https://accord-agent-exchange.${domain}`;
const stage=process.env.DEMO_WORKSPACE_ID||'ef5d07d4-fc2a-41d9-b0bc-e1869dfb8e7c';
const origins=[
  {id:'exchange',origin:exchange},
  {id:'dating',publisher:'wavelength',origin:process.env.DATING_URL||`https://accord-dating-demo.${domain}`},
  {id:'fashion',publisher:'wardrobe',origin:process.env.SHOPPING_URL||`https://accord-shopping-demo.${domain}`},
  {id:'outings',publisher:'cityguide',origin:process.env.OUTINGS_URL||`https://accord-outings-demo.${domain}`},
];
const evidence={started_at:new Date().toISOString(),read_only:true,origins:[],checks:[]};
const secretPattern=/(?:sk_live_|sk_test_|sk-proj-)[A-Za-z0-9]{16,}/;
const pass=name=>{evidence.checks.push(name);console.log(`PASS ${name}`);};
async function get(url,json=false){
  const r=await fetch(url,{headers:{'x-demo-workspace':stage},signal:AbortSignal.timeout(30000)});
  assert.equal(r.status,200,`${url}: HTTP ${r.status}`);
  const text=await r.text();
  assert.ok(!secretPattern.test(text),`${url}: unexpected credential-like literal`);
  return {data:json?JSON.parse(text):text,type:r.headers.get('content-type'),etag:r.headers.get('etag')};
}
try{
  assert.equal(new Set(origins.map(app=>new URL(app.origin).hostname)).size,4,'Expected four distinct deployed servers');
  pass('Four separate deployment origins');
  await Promise.all(origins.map(async app=>{
    const {data:html,type}=await get(app.origin+'/');
    assert.match(type||'',/text\/html/);assert.match(html,/<html[^>]+lang="en"/);assert.match(html,/<div id="root"><\/div>/);
    const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map(match=>match[1]);
    assert.ok(assets.some(asset=>asset.endsWith('.js'))&&assets.some(asset=>asset.endsWith('.css')),`${app.id}: missing versioned assets`);
    const assetEvidence=await Promise.all(assets.map(async asset=>{
      const result=await get(app.origin+asset);assert.ok(result.data.length>100);
      if(asset.endsWith('.js'))assert.match(result.type||'',/(?:javascript|ecmascript)/);
      if(asset.endsWith('.css')){
        assert.match(result.type||'',/text\/css/);assert.match(result.data,/prefers-reduced-motion\s*:\s*reduce/);
        assert.match(result.data,/focus-visible/);
      }
      return {path:asset,bytes:Buffer.byteLength(result.data),content_type:result.type,etag:result.etag};
    }));
    const {data:context}=await get(app.origin+(app.id==='exchange'?'/api/bootstrap':'/api/context'),true);
    assert.ok(!context.error,`${app.id}: API error`);
    if(app.id==='exchange'){
      assert.equal(context.brands.length,9);assert.equal(context.scenarios.length,3);assert.equal(context.presentation.workspace_id,stage);
      assert.equal(context.capabilities.live_agents,true);
      const recorded=context.auctions.filter(a=>a.id?.startsWith('recorded:'));
      assert.equal(recorded.length,1);assert.equal(recorded[0].status,'completed');assert.ok(recorded[0].rounds.length>0);assert.ok(!recorded[0].placement);
      pass('Exchange bootstrap: nine brands, three scenarios, shared stage and read-only recorded replay');
    }else{
      assert.equal(context.scenario.id,app.id);assert.equal(context.scenario.publisher_id,app.publisher);assert.equal(context.stage_id,stage);
      assert.equal(context.agent_mode,'live');assert.equal(context.exchange_url.replace(/\/$/,''),exchange.replace(/\/$/,''));
      assert.ok(['simulation','sandbox'].includes(context.payment_mode));
      pass(`${app.id}: server-owned publisher identity and shared exchange target`);
    }
    evidence.origins.push({id:app.id,origin:app.origin,assets:assetEvidence,payment_mode:context.payment_mode,live_agents:context.capabilities?.live_agents});
    pass(`${app.id}: HTML, JavaScript, CSS, reduced-motion and focus styling served successfully`);
  }));
  evidence.passed=true;
}catch(error){evidence.passed=false;evidence.error=error.stack||String(error);console.error(evidence.error);process.exitCode=1;}
finally{
  evidence.completed_at=new Date().toISOString();evidence.origins.sort((a,b)=>a.id.localeCompare(b.id));
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  await fs.writeFile(path.join(root,'test-results/presentation-verification.json'),JSON.stringify(evidence,null,2)+'\n');
  const report=`# Presentation deployment regression\n\n${evidence.passed?'PASS':'INCOMPLETE'} — ${evidence.completed_at}\n\nRead-only HTTP verification of four independently deployed Workers. No auctions, campaigns, clicks, Stripe objects, or secrets were changed by this check.\n\n${evidence.checks.map(check=>'- '+check).join('\n')}\n\n## Scope\n\nThis verifies served asset responses, content types, API configuration and static motion/focus declarations. It does not execute JavaScript or establish visual correctness, keyboard focus behavior, or browser-console cleanliness. Browser review is separate. Live auction and accounting evidence is in FOUR-APP-VERIFICATION.md and STRIPE-VERIFICATION.md.\n\n## Reproduce\n\nRun \`node scripts/verify-presentation.mjs\` with Node 22 or newer. Full asset hashes and results are in \`test-results/presentation-verification.json\`.\n${evidence.error?'\n## Failure\n\n```\n'+evidence.error+'\n```\n':''}`;
  await fs.mkdir(path.join(root,'docs'),{recursive:true});await fs.writeFile(path.join(root,'docs/PRESENTATION-VERIFICATION.md'),report);
}
