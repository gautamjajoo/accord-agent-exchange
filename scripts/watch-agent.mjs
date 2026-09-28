#!/usr/bin/env node
/** Read-only subscriber to actual server traces. This process does not run a brand model. */
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const DEFAULT_URL='https://accord-agent-exchange.kairosity-main-website.workers.dev';
const DEFAULT_WORKSPACE='ef5d07d4-fc2a-41d9-b0bc-e1869dfb8e7c';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const scalar=x=>typeof x==='number'&&Number.isFinite(x)||typeof x==='boolean'||x===null;
const safeText=value=>String(value)
  .replace(/[\u0000-\u001f\u007f-\u009f]/g,' ')
  .replace(/\b(?:sk|rk|pk)_(?:test|live|proj)_[A-Za-z0-9_-]+\b/g,'[REDACTED]')
  .replace(/\b(?:sk|whsec)_[A-Za-z0-9_-]+\b/g,'[REDACTED]')
  .replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]')
  .slice(0,600);
const fields=(obj,keys)=>!record(obj)?undefined:Object.fromEntries(keys.filter(k=>Object.hasOwn(obj,k)&&(scalar(obj[k])||typeof obj[k]==='string')).map(k=>[k,typeof obj[k]==='string'?safeText(obj[k]):obj[k]]));
const strings=value=>Array.isArray(value)?value.filter(x=>typeof x==='string').slice(0,30).map(safeText):undefined;
const amounts=obj=>fields(obj,['brand_id','brand_name','bid_cents','discount_cents','base_price_cents','effective_price_cents','fit_score','price_score','user_score','finalized']);
const action=obj=>typeof obj==='string'?safeText(obj):fields(obj,['action','bid_cents','discount_cents','final']);
const catalog=obj=>({...fields(obj,['brand_id','name','item','base_price_cents','price_kind','source_date']),tags:strings(obj?.tags)});
const offerList=value=>Array.isArray(value)?value.slice(0,12).map(amounts):undefined;

/** Extra client-side allowlist. Never print arbitrary payload objects or private campaign fields. */
export function publicPayload(event) {
  const p=event.payload;if(!record(p))return undefined;
  if(event.kind==='model.request'){
    const input=record(p.input)?p.input:{};
    const previous=record(input.previous_completed_round)?input.previous_completed_round:null;
    return {...fields(p,['model','store','max_output_tokens','parallel_tool_calls']),tool_choice:fields(p.tool_choice,['type','name']),input:{
      ...fields(input,['intent','round','max_rounds','reference_price_cents']),preferences:strings(input.preferences),
      ...(record(input.own_catalog)?{own_catalog:catalog(input.own_catalog)}:{}),
      ...(record(input.own_fit)?{own_fit:fields(input.own_fit,['brand_id','score'])}:{}),
      ...(record(input.own_previous_offer)?{own_previous_offer:amounts(input.own_previous_offer)}:{}),
      ...(Array.isArray(input.catalog)?{catalog:input.catalog.slice(0,12).map(catalog)}:{}),
      ...(previous?{previous_completed_round:{...fields(previous,['number','leader_id']),offers:offerList(previous.offers)}}:{}),
    }};
  }
  if(event.kind==='model.response')return {...fields(p,['tool']),arguments:{...action(p.arguments),...(Array.isArray(p.arguments?.fits)?{fits:p.arguments.fits.slice(0,12).map(x=>fields(x,['brand_id','score']))}:{})}};
  const allowed=fields(p,['auction_id','scenario','publisher_id','mode','payment_mode','round','deadline','leader_id','cash_leader_id','end_reason','status','brand_id','placement_id','bid_cents','discount_cents','effective_price_cents','amount_cents','publisher_cents','network_cents']);
  return {...allowed,
    ...(Array.isArray(p.participants)?{participants:strings(p.participants)}:{}),
    ...(Array.isArray(p.offers)?{offers:offerList(p.offers)}:{}),
    ...(record(p.actions)?{actions:Object.fromEntries(Object.entries(p.actions).filter(([id])=>/^[a-z0-9-]{1,60}$/.test(id)).slice(0,12).map(([id,value])=>[id,action(value)]))}:{}),
    ...(record(p.winner)?{winner:amounts(p.winner)}:{}),
  };
}
export function parseArgs(args){
  const options={url:DEFAULT_URL,workspace:DEFAULT_WORKSPACE,brand:null,all:false,once:false,auction:null,help:false};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--all')options.all=true;
    else if(arg==='--once')options.once=true;
    else if(arg==='--help'||arg==='-h')options.help=true;
    else if(['--url','--workspace','--brand','--auction'].includes(arg)){
      const value=args[++i];if(!value||value.startsWith('--'))throw new Error(`Missing value for ${arg}`);options[arg.slice(2)]=value;
    }else throw new Error(`Unknown option: ${safeText(arg)}`);
  }
  if(options.help)return options;
  if(options.all&&options.brand)throw new Error('Choose --brand or --all, not both.');
  if(!options.all&&!options.brand)options.all=true;
  if(options.brand&&!/^[a-z0-9-]{1,60}$/.test(options.brand))throw new Error('Brand must be a catalog ID such as blue-bottle.');
  if(!UUID.test(options.workspace))throw new Error('Workspace must be a UUID.');
  if(options.auction&&!UUID.test(options.auction))throw new Error('Auction must be a UUID.');
  const url=new URL(options.url);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('--url must be an origin without credentials, path, query, or fragment.');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Use HTTPS, or HTTP on localhost.');
  options.url=url.origin;return options;
}
function endpoint(value){
  if(typeof value!=='string')return undefined;
  try{const url=new URL(value);return `${url.protocol}//${url.hostname}${/^\/v1\/responses$/.test(url.pathname)?url.pathname:'/[path omitted]'}`;}catch{return undefined;}
}
export function renderTrace(event,auctionId){
  const meta=fields(event,['at','kind','actor','round','correlation_id','method','provider','model','status','http_status','duration_ms','provider_request_id']);
  const provisional=event.kind==='model.response'?' [PROVISIONAL — not an exchange commit]':'';
  const title=`${safeText(event.at??'')}  ${safeText(event.actor??'exchange')}  ${safeText(event.kind??'trace')}${provisional}`;
  const body={auction_id:safeText(auctionId),...meta,...(endpoint(event.url)?{url:endpoint(event.url)}:{}),
    ...(event.payload!==undefined?{payload:publicPayload(event)}:{}),
    ...(Array.isArray(event.redacted)?{redacted:strings(event.redacted)}:{}),
    ...(typeof event.error==='string'?{error:safeText(event.error)}:{})};
  return `${title}\n${JSON.stringify(body,null,2)}\n`;
}
const help=`Accord agent trace subscriber — Node.js 24+, no dependencies\n\nUsage:\n  node scripts/watch-agent.mjs --brand blue-bottle\n  node scripts/watch-agent.mjs --brand sightglass\n  node scripts/watch-agent.mjs --brand ritual\n  node scripts/watch-agent.mjs --all [--once]\n\nOptions: --url ORIGIN --workspace UUID --auction UUID --once --help\nDefaults: ${DEFAULT_URL}\n          workspace ${DEFAULT_WORKSPACE}\n\nThis is a read-only 1-second polling subscriber. Brand execution stays on the server.\nUses ACCORD_OPERATOR_TOKEN (or the local operator token for the default deployment). Model keys, Stripe credentials, and private budgets are never printed.\n`;
export async function main(args=process.argv.slice(2)){
  const options=parseArgs(args);if(options.help){console.log(help);return;}
  let operatorToken=process.env.ACCORD_OPERATOR_TOKEN||process.env.ADMIN_TOKEN||'';
  if(!operatorToken&&options.url===DEFAULT_URL){
    try{const local=readFileSync(new URL('../.dev.vars',import.meta.url),'utf8');const row=local.split('\n').find(line=>line.startsWith('ADMIN_TOKEN='));if(row)operatorToken=row.slice(row.indexOf('=')+1).trim().replace(/^['\"]|['\"]$/g,'');}catch{/* Remote users supply ACCORD_OPERATOR_TOKEN. */}
  }
  const shutdown=new AbortController();const stop=()=>shutdown.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const seen=new Set(),announced=new Set(),uninstrumented=new Set();let focused=null,lastError=null,cookie='';
  const bold=s=>process.stdout.isTTY?`\x1b[1;32m${s}\x1b[0m`:s;
  console.log(bold(`ACCORD / ${options.brand??'ALL AGENTS'} / SERVER TRACE SUBSCRIBER`));
  console.log(`READ ONLY · 1s polling · ${options.url}\nWorkspace ${options.workspace}\nThis terminal observes actual server agent execution; it does not run the model process.\nNetwork payloads are allowlisted, redacted projections. Model responses are provisional until round.committed.\n`);
  async function get(path){
    const response=await fetch(options.url+path,{headers:{'x-demo-workspace':options.workspace,...(operatorToken?{'x-admin-token':operatorToken}:{}),...(cookie?{cookie}:{})},signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(5000)])});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
    return response.json();
  }
  try{
    while(!shutdown.signal.aborted){
      try{
        const snapshot=await get('/api/bootstrap');
        if(snapshot.presentation?.workspace_id&&snapshot.presentation.workspace_id!==options.workspace)throw new Error('Server selected a different presentation workspace.');
        let auctions=Array.isArray(snapshot.auctions)?snapshot.auctions:[];
        if(options.auction){
          let fixed=auctions.find(a=>a.id===options.auction);if(!fixed)fixed=await get(`/v1/auctions/${options.auction}`);
          auctions=[fixed];
        }
        if(options.brand)auctions=auctions.filter(a=>Array.isArray(a.bidders)&&a.bidders.some(b=>b.brand?.id===options.brand));
        auctions.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id)));
        // At startup replay the newest relevant auction. Then keep following new arrivals.
        if(!focused&&auctions.length){focused=auctions.at(-1).id;auctions=auctions.slice(-1);}
        else if(focused){const index=auctions.findIndex(a=>a.id===focused);if(index>=0)auctions=auctions.slice(index);}
        if(lastError){console.log('Connection restored.');lastError=null;}
        if(!auctions.length&&options.once)console.log('No matching auction in this workspace. No records invented.');
        for(const auction of auctions){
          if(!announced.has(auction.id)){
            announced.add(auction.id);console.log(bold(`AUCTION ${safeText(auction.id)} · ${safeText(auction.scenario)} · ${safeText(auction.mode)} agents · ${safeText(auction.status)}`));
          }
          const traces=Array.isArray(auction.trace)?auction.trace:[];
          if(!traces.length&&!uninstrumented.has(auction.id)){
            uninstrumented.add(auction.id);console.log('No instrumentation recorded for this auction yet. Historical model/network activity cannot be reconstructed.');
          }
          for(const trace of traces){
            if(!record(trace)||typeof trace.id!=='string')continue;
            const id=`${auction.id}:${trace.id}`;if(seen.has(id))continue;seen.add(id);
            if(options.brand&&trace.actor!==options.brand&&trace.actor!=='exchange')continue;
            console.log(renderTrace(trace,auction.id));
          }
        }
      }catch(error){
        if(shutdown.signal.aborted)break;
        const summary=error instanceof Error&&/^HTTP \d{3}$/.test(error.message)?error.message:error instanceof Error&&error.message==='Server selected a different presentation workspace.'?error.message:'Connection or response unavailable';
        if(summary!==lastError){console.error(`Subscriber: ${summary}. ${options.once?'':'Retrying; server auction continues independently.'}`);lastError=summary;}
        if(options.once)process.exitCode=1;
      }
      if(options.once)break;
      await new Promise(resolve=>{const timer=setTimeout(done,1000);function done(){clearTimeout(timer);shutdown.signal.removeEventListener('abort',done);resolve();}shutdown.signal.addEventListener('abort',done,{once:true});});
    }
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){main().catch(()=>{console.error('Invalid subscriber configuration. Run with --help.');process.exitCode=1;});}
