/** Crash/restart smoke against a separate local Wrangler and persistence tree. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.RECOVERY_PORT||8788),origin=`http://127.0.0.1:${port}`;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let worker,cookie='',log='';const evidence={origin,started_at:new Date().toISOString()};
async function api(route,body){const response=await fetch(origin+route,{method:body?'POST':'GET',headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});cookie=response.headers.get('set-cookie')?.split(';')[0]||cookie;const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;}
async function start(){worker=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--port',String(port),'--persist-to','.wrangler/verify-recovery'],{cwd:root,env:{...process.env,BROWSER:'none'},stdio:['ignore','pipe','pipe']});worker.stdout.on('data',chunk=>{log+=chunk});worker.stderr.on('data',chunk=>{log+=chunk});for(let i=0;i<100;i++){if(worker.exitCode!==null)throw Error(`Wrangler stopped ${worker.exitCode}: ${log.slice(-1000)}`);try{await api('/api/bootstrap');return;}catch{}await wait(200);}throw Error('Recovery Wrangler did not become ready');}
async function stop(){if(!worker||worker.exitCode!==null)return;const closed=new Promise(r=>worker.once('exit',r));worker.kill('SIGTERM');await closed;}
try{
  await start();const bootstrap=await api('/api/bootstrap');assert.ok(bootstrap.capabilities.live_agents,'OPENAI_API_KEY required for real interrupted round test');
  let a=await api('/api/demo/dating/auctions',{mode:'live',intent:'Coffee for two for a casual date in San Francisco',preferences:['Casual date','Affordable two coffees'],target_score:100,max_rounds:5});
  const id=a.id,deadline=Date.now()+60000;
  while(Date.now()<deadline){a=await api('/v1/auctions/'+id);if(a.current_round>=2&&a.round_deadline&&a.status==='running')break;if(['completed','failed'].includes(a.status))throw Error('Auction ended before interruptible revision round');await wait(75);}
  assert.ok(a.rounds.length>=1&&a.round_deadline,'Must observe persisted in-flight revision round');
  const committed=structuredClone(a.rounds),interruptedRound=a.current_round;
  await stop();await start();
  const recovered=await api('/v1/auctions/'+id);assert.deepEqual(recovered.rounds.slice(0,committed.length),committed);
  const end=Date.now()+120000;
  while(Date.now()<end&&!['completed','failed','cancelled'].includes(a.status)){a=await api('/v1/auctions/'+id);await wait(300);}
  assert.equal(a.status,'completed');assert.deepEqual(a.rounds.slice(0,committed.length),committed);assert.ok(a.rounds.length<=5);assert.equal(new Set(a.rounds.map(r=>r.number)).size,a.rounds.length);assert.ok(a.winner&&a.placement);
  Object.assign(evidence,{passed:true,auction_id:id,interrupted_round:interruptedRound,committed_rounds_before_restart:committed.length,final_rounds:a.rounds.length,end_reason:a.end_reason,model:bootstrap.capabilities.model,checks:['persisted in-flight round resumed','committed rounds unchanged after restart','no duplicate round numbers','winner and reservation created']});console.log(JSON.stringify(evidence,null,2));
}catch(error){evidence.passed=false;evidence.error=error.stack||String(error);console.error(evidence.error);process.exitCode=1;}
finally{await stop();evidence.completed_at=new Date().toISOString();await fs.mkdir(path.join(root,'test-results'),{recursive:true});await fs.writeFile(path.join(root,'test-results/recovery-verification.json'),JSON.stringify(evidence,null,2)+'\n');}
