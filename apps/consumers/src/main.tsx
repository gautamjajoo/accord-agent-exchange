import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { ArrowUp, ArrowUpRight, Check, ChevronRight, Coffee, Compass, Heart, MapPin, Plus, RefreshCw, Shirt, X } from 'lucide-react';
import type { Auction, Scenario, Placement } from '../../../src/shared/types';
import { brands } from '../../../src/shared/catalog';
type ConsumerAuction = Pick<Auction,'id'|'scenario'|'publisher_id'|'intent'|'preferences'|'mode'|'payment_mode'|'status'|'created_at'|'updated_at'|'end_reason'|'error'|'winner'|'placement'|'current_round'|'max_rounds'>;
import { buildConsumerIntent } from './conversation';
import './style.css';

type Context = {scenario:Scenario;exchange_url:string;stage_id:string;payment_mode?:'simulation'|'sandbox';agent_mode?:'live'};
type Message = {role:'user'|'assistant';text:string};
const money=(c:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:c%100?2:0}).format(c/100);
class ApiError extends Error { constructor(message:string, readonly status:number) { super(message); } }
async function api<T>(path:string,body?:unknown):Promise<T>{
 const r=await fetch(path,{signal:AbortSignal.timeout(20000),...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
 const d=await r.json() as T & {error?:string}; if(!r.ok)throw new ApiError(d.error||'Something went wrong. Please try again.',r.status);return d;
}
const storage={
 get(key:string){try{return sessionStorage.getItem(key);}catch{return null;}},
 set(key:string,value:string){try{sessionStorage.setItem(key,value);}catch{/* A blocked browser store must not interrupt a request. */}},
 remove(key:string){try{sessionStorage.removeItem(key);}catch{/* Storage is optional. */}},
};
function StatusNote({status,sending,pendingText}:{status?:Auction['status'];sending:boolean;pendingText:string}){
 const label=sending?'Sending your request':status==='assessing'?'Considering what matters to you':status==='paused'?'Your search is saved':'Comparing your options';
 return <motion.div className="message assistant pending" role="status" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}} transition={{duration:.24}}>
  <div className="search-signal" aria-hidden="true"><span/><span className="signal-core"/></div>
  <div><span className="message-name">{label}</span><p>{status==='paused'?'Your search will resume when the exchange continues.':pendingText}</p>
  <div className={`thinking-dots ${status==='paused'?'resting':''}`} aria-hidden="true"><i/><i/><i/></div></div>
 </motion.div>;
}
const content={
 dating:{name:'Wavelength',section:'Connections',title:'Your first date',contextTitle:<>You & Alex.<br/><span>Make a plan.</span></>,description:'You both picked coffee over cocktails. Find somewhere to meet in San Francisco.',welcome:'You and Alex matched. You both mentioned coffee, architecture, and weekends exploring the city.',followup:'A casual coffee date sounds right. I can find a café for the two of you—any neighborhood in mind?',hint:'Find somewhere for our first coffee…',button:'Find a café for us',pending:'Looking for a café that fits your plans.',result:'Here’s a place for the two of you.',contextLabel:'Your plan',contextRows:[['Where','San Francisco'],['What','Coffee for two'],['Mood','Casual first date']],icon:Heart},
 fashion:{name:'Thread',section:'Personal shopping',title:'Your everyday sneakers',contextTitle:<>Made for<br/><span>your routine.</span></>,description:'A practical pair for walking around San Francisco. Comfort and easy care come first.',welcome:'Let’s find everyday women’s sneakers for walking around SF. You’re looking for comfort and something easy to clean.',followup:'I’ll compare options around those preferences. Tell me if you have a budget, material, or color in mind.',hint:'Tell me what you need from your next pair…',button:'Find my everyday sneakers',pending:'Comparing sneakers around your preferences.',result:'This pair fits your brief.',contextLabel:'Your brief',contextRows:[['Use','Daily city walking'],['Priority','Comfort'],['Care','Easy to clean']],icon:Shirt},
 outings:{name:'Roam',section:'San Francisco',title:'Plan an outing',contextTitle:<>Out in<br/><span>San Francisco.</span></>,description:'Art, hands-on science, and a few hours to explore. Pick an experience to share.',welcome:'You’re looking for an SF outing that brings together art and hands-on science. There are a few different ways to spend the evening.',followup:'I’ll find an experience for two. Have a neighborhood, day, or budget in mind?',hint:'What should we do in San Francisco?…',button:'Find an outing for two',pending:'Comparing local experiences for your plans.',result:'An option for your next outing.',contextLabel:'Your plans',contextRows:[['City','San Francisco'],['Interests','Art & science'],['Group','Two people']],icon:Compass},
};

function Mark({kind}:{kind:Scenario['id']}){
 return <svg viewBox="0 0 30 30" width="30" height="30" fill="none" aria-hidden="true">{kind==='dating'?<><path d="M3 10c5-9 10 18 15 9S23 2 27 10" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round"/><path d="M3 19c5-9 10 18 15 9S23 11 27 19" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" transform="translate(0 -7)" opacity=".45"/></>:kind==='fashion'?<><path d="M5 6h20M15 6v20M5 14h20" stroke="currentColor" strokeWidth="2.5"/><circle cx="24" cy="25" r="2" fill="currentColor"/></>:<><path d="m15 3 12 24-12-6-12 6L15 3Z" stroke="currentColor" strokeWidth="2"/><path d="M15 3v18" stroke="currentColor" strokeWidth="2"/></>}</svg>;
}
function Miniature({kind}:{kind:Scenario['id']}){
 const point=(x:number,y:number,z=0)=>`${240+(x-y)*1.3},${166+(x+y)*.65-z}`;
 const Box=({x,y,w,d,h,z=0,top='#e4dfeb',left='#cec5d8',right='#b7a9c6'}:{x:number;y:number;w:number;d:number;h:number;z?:number;top?:string;left?:string;right?:string})=><g><polygon points={[point(x,y,z+h),point(x+w,y,z+h),point(x+w,y+d,z+h),point(x,y+d,z+h)].join(' ')} fill={top}/><polygon points={[point(x,y,z+h),point(x,y+d,z+h),point(x,y+d,z),point(x,y,z)].join(' ')} fill={left}/><polygon points={[point(x,y+d,z+h),point(x+w,y+d,z+h),point(x+w,y+d,z),point(x,y+d,z)].join(' ')} fill={right}/></g>;
 const Tree=({x,y}:{x:number;y:number})=>{const [cx,cy]=point(x,y).split(',').map(Number);return <g><ellipse cx={cx+5} cy={cy+2} rx="14" ry="5" fill="#484638" opacity=".08"/><path d={`M${cx} ${cy}v-27`} stroke="#8a7b6e" strokeWidth="4"/><ellipse cx={cx} cy={cy-30} rx="13" ry="21" fill="#85b8a2"/><ellipse cx={cx-4} cy={cy-33} rx="8" ry="17" fill="#a7d8c1"/></g>};
 const Person=({x,y,color='#65486f'}:{x:number;y:number;color?:string})=>{const [cx,cy]=point(x,y).split(',').map(Number);return <g><ellipse cx={cx+2} cy={cy+2} rx="9" ry="3" fill="#352e43" opacity=".1"/><path d={`M${cx-3} ${cy-11}v11m6-11v11`} stroke="#484050" strokeWidth="2.5" strokeLinecap="round"/><path d={`M${cx-5} ${cy-25}q5-4 10 0l1 15h-12Z`} fill={color}/><circle cx={cx} cy={cy-31} r="5" fill="#caab93"/><path d={`M${cx-5} ${cy-33}q1-6 7-3l3 5h-10Z`} fill="#4b3e38"/></g>};
 return <svg className="miniature" viewBox="0 0 480 330" role="img" aria-label={kind==='dating'?'Illustration of a neighborhood café with two people at an outdoor table':kind==='fashion'?'Illustration of a clothing studio with a garment rail and shoe display':'Illustration of a San Francisco museum neighborhood'}>
 <ellipse cx="252" cy="276" rx="163" ry="25" fill="#dedce5" opacity=".25"/>
 <Box x={-92} y={-73} w={172} d={155} h={9} top="#edeaf1" left="#e1dce8" right="#d8d1e1"/>
 {kind==='dating'?<>
 <Box x={-73} y={-58} w={79} d={62} h={79} top="#efece4" left="#d8d0c5" right="#c4b9ac"/>
 <polygon points={[point(-65,5,62),point(-15,5,62),point(-15,5,20),point(-65,5,20)].join(' ')} fill="#4c5660"/>
 <path d={`M${point(-39,5,62)}L${point(-39,5,20)}`} stroke="#e4dad0" strokeWidth="3"/>
 <polygon points={[point(-69,0,68),point(1,0,68),point(1,18,57),point(-69,18,57)].join(' ')} fill="#65486f"/>
 <polygon points={[point(-69,18,57),point(1,18,57),point(1,18,49),point(-69,18,49)].join(' ')} fill="#82698c"/>
 <text x="169" y="128" transform="rotate(26.5 169 128)" fontFamily="Switzer,sans-serif" fontSize="8" fill="#fff" letterSpacing="1.6">COFFEE</text>
 <polygon points={[point(-73,-58,79),point(6,-58,79),point(6,4,79),point(-73,4,79)].join(' ')} fill="#f7f5ef"/>
 <Box x={-43} y={-34} w={20} d={17} h={14} z={79} top="#c6b9cf" left="#9886a5" right="#ad9abd"/>
 <Tree x={49} y={-48}/><Tree x={-76} y={65}/>
 <Box x={23} y={33} w={21} d={21} h={25} top="#e6c39a" left="#a28a76" right="#bda180"/>
 <ellipse cx="224" cy="180" rx="20" ry="10" fill="#e4c8a5"/>
 <ellipse cx="219" cy="177" rx="3" ry="2" fill="#fbfaf4"/><ellipse cx="233" cy="183" rx="3" ry="2" fill="#fbfaf4"/>
 <Person x={12} y={35}/><Person x={57} y={37} color="#78aa98"/>
 <Box x={28} y={-51} w={15} d={15} h={8} top="#f4ebe0" left="#c9b6a6" right="#b3a28c"/>
 <path d="M167 270q65 28 112 2" stroke="#b7bdba" fill="none" strokeWidth="1.5" strokeDasharray="4 5"/>
 </>:kind==='fashion'?<>
 <Box x={-63} y={-47} w={109} d={5} h={97} top="#e4e0d8" left="#d4cec4" right="#e9e6e0"/>
 <Box x={-65} y={-45} w={5} d={97} h={97} top="#ede9e2" left="#e0dad0" right="#d5cec4"/>
 <path d={`M${point(-44,-26,8)}L${point(-44,-26,73)}L${point(27,-26,73)}L${point(27,-26,8)}`} fill="none" stroke="#737078" strokeWidth="3"/>
 {[-32,-10,12].map((x,i)=><g key={x}><path d={`M${point(x,-26,73)}l0 10-7 6 7 3 7-3-7-6`} fill="none" stroke="#797680" strokeWidth="1.5"/><path d={`M${point(x,-26,60)}l-10 5-5 10 7 4 3-5-1 29 20 0-1-29 3 5 7-4-5-10Z`} fill={['#b5c9bb','#b19cbd','#ece7dc'][i]}/></g>)}
 <Box x={-15} y={20} w={58} d={39} h={24} top="#f8f6ef" left="#ddd5c9" right="#c8beaf"/>
 <path d="M228 181q11 2 13 11l16 6q3 2 2 6h-40l1-21Z" fill="#eeeae0" stroke="#b6b2a8" strokeWidth=".8"/>
 <path d="M219 203h40" stroke="#ad9e89" strokeWidth="3"/><path d="m235 191 7-2m-4 6 7-2" stroke="#aaa59c" strokeWidth="1.5"/>
 <Box x={52} y={-35} w={10} d={30} h={75} top="#beafa0" left="#d2c5b8" right="#af9f8d"/>
 <polygon points={[point(52,-32,70),point(52,-8,70),point(52,-8,14),point(52,-32,14)].join(' ')} fill="#bed3cd"/>
 <Tree x={50} y={65}/><Person x={-48} y={45} color="#7f858d"/>
 </>:<>
 <polygon points={[point(-91,-15,10),point(80,-15,10),point(80,7,10),point(-91,7,10)].join(' ')} fill="#faf9fa"/>
 <polygon points={[point(13,-72,10),point(32,-72,10),point(32,81,10),point(13,81,10)].join(' ')} fill="#faf9fa"/>
 <Box x={-76} y={-58} w={57} d={39} h={62} top="#efe9df" left="#d9cabc" right="#bca995"/>
 <Box x={-69} y={-50} w={42} d={22} h={73} top="#f8f3e7" left="#d5c8b3" right="#c9baa1"/>
 {[-65,-49,-33].map(x=><polygon key={x} points={[point(x,-18,49),point(x+7,-18,49),point(x+7,-18,17),point(x,-18,17)].join(' ')} fill="#756779"/>)}
 <Box x={41} y={-54} w={28} d={34} h={85} top="#c9d6d9" left="#a4bfc1" right="#8aa7b3"/>
 <Box x={42} y={22} w={29} d={42} h={42} top="#dccbe6" left="#ad96bd" right="#8d729e"/>
 <Box x={-56} y={23} w={38} d={36} h={22} top="#b9d7c7" left="#90bba4" right="#719d88"/>
 <ellipse cx="133" cy="183" rx="29" ry="18" fill="#c7e1d3"/><Tree x={-39} y={43}/><Tree x={4} y={62}/><Tree x={71} y={2}/>
 <Person x={20} y={20} color="#c59a74"/><Person x={8} y={-8}/><Person x={-40} y={-4} color="#78aa98"/>
 <path d="M265 257l12-7 10 5-12 7Z" fill="#b3bac4"/>
 </>}
 </svg>;
}

function App(){
 const [ctx,setCtx]=useState<Context|null>(null);
 const [error,setError]=useState('');
 const [messages,setMessages]=useState<Message[]>([]);
 const [input,setInput]=useState('');
 const [auction,setAuction]=useState<ConsumerAuction|null>(null);
 const [sending,setSending]=useState(false);
 const [clicking,setClicking]=useState(false);
 const [copied,setCopied]=useState(false);
 const [details,setDetails]=useState(false);
 const [recovering,setRecovering]=useState(false);
 const [recoveryFailed,setRecoveryFailed]=useState(false);
 const [connectionLost,setConnectionLost]=useState(false);
 const bottom=useRef<HTMLDivElement>(null);
 const resultCard=useRef<HTMLDivElement>(null);
 const scroll=useRef<HTMLDivElement>(null);
 const followScroll=useRef(true);
 const reducedMotion=useReducedMotion();
 const storeKey=(c:Context)=>`consumer-auction:${c.stage_id}:${c.scenario.id}`;
 async function restore(c:Context){
  const saved=storage.get(storeKey(c));
  if(!saved)return;
  setRecovering(true);setRecoveryFailed(false);
  try{
   const a=await api<ConsumerAuction>(`/api/auctions/${encodeURIComponent(saved)}`);
   setAuction(a);
   const savedMessages=storage.get(`${storeKey(c)}:messages`);
   let history:Message[]=[];
   if(savedMessages){try{const parsed=JSON.parse(savedMessages);if(Array.isArray(parsed))history=parsed.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string');}catch{/* Recover the request from the server instead. */}}
   setMessages(history.length?history:[{role:'user',text:a.intent}]);
   setConnectionLost(false);
  }catch(e){
   if(e instanceof ApiError&&e.status===404){storage.remove(storeKey(c));storage.remove(`${storeKey(c)}:messages`);}
   else setRecoveryFailed(true);
  }finally{setRecovering(false);}
 }
 useEffect(()=>{api<Context>('/api/context').then(c=>{setCtx(c);document.title=`${content[c.scenario.id].name} — your plans`;void restore(c);}).catch(e=>setError(e.message));},[]);
 const pending=auction&&['assessing','running','paused'].includes(auction.status);
 useEffect(()=>{
  if(!pending||!auction)return;
  let live=true;let timer:ReturnType<typeof setTimeout>;
  const refresh=async()=>{
   try{const a=await api<ConsumerAuction>(`/api/auctions/${encodeURIComponent(auction.id)}`);if(live){setAuction(a);setConnectionLost(false);}}
   catch{if(live)setConnectionLost(true);}
   finally{if(live)timer=setTimeout(refresh,1000);}
  };
  timer=setTimeout(refresh,1000);
  return()=>{live=false;clearTimeout(timer);};
 },[auction?.id,pending]);
 useEffect(()=>{
  if(!followScroll.current)return;
  const id=requestAnimationFrame(()=>{const result=auction?.status==='completed'&&resultCard.current;if(result)result.scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'start'});else bottom.current?.scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'nearest'});});
  return()=>cancelAnimationFrame(id);
 },[messages.length,auction?.status,sending,reducedMotion]);
 if(!ctx)return <main className="loading"><div className="loading-mark"><RefreshCw size={24}/></div><p>{error||'Opening your conversation…'}</p>{error&&<button onClick={()=>location.reload()}>Try again</button>}</main>;
 const c=content[ctx.scenario.id];const Icon=c.icon;const winner=auction?.winner;const brand=brands.find(b=>b.id===winner?.brand_id);const place=auction?.placement;const exchange=new URL(ctx.exchange_url);exchange.searchParams.set('workspace',ctx.stage_id);if(auction)exchange.searchParams.set('auction',auction.id);
 async function send(text:string){
  if(!text.trim()||sending||pending||recovering||recoveryFailed)return;
  const nextMessages=[...messages,{role:'user' as const,text:text.trim()}];
  setSending(true);setError('');setInput('');setMessages(nextMessages);setAuction(null);setDetails(false);setCopied(false);followScroll.current=true;
  try{
   const intent=buildConsumerIntent(ctx!.scenario.prompt,messages.filter(m=>m.role==='user').map(m=>m.text),text);
   const a=await api<ConsumerAuction>('/api/auctions',{intent,preferences:ctx!.scenario.preferences});
   setAuction(a);storage.set(storeKey(ctx!),a.id);storage.set(`${storeKey(ctx!)}:messages`,JSON.stringify(nextMessages));
  }catch(e){setInput(text);setMessages(messages);setError(e instanceof Error?e.message:'Could not send your request.');}
  finally{setSending(false);}
 }
 async function copyCode(){
  if(!place)return;
  try{await navigator.clipboard.writeText(place.code);setCopied(true);setTimeout(()=>setCopied(false),2000);}
  catch{setError('Copy isn’t available in this browser. You can select the code below.');}
 }
 async function click(){if(!place||clicking)return;setClicking(true);setError('');const tab=window.open('about:blank','_blank');try{const result=await api<{destination:string;placement?:Placement}>(`/api/placements/${encodeURIComponent(place.id)}/click`,{auction_id:auction!.id});if(tab){tab.opener=null;tab.location.href=result.destination;}else location.href=result.destination;if(result.placement)setAuction(a=>a?{...a,placement:result.placement}:a);}catch(e){tab?.close();setError(e instanceof Error?e.message:'Could not open this recommendation.');}finally{setClicking(false);}}
 function reset(){if(pending||sending||recovering)return;setMessages([]);setAuction(null);setError('');setRecoveryFailed(false);setConnectionLost(false);setInput('');setDetails(false);storage.remove(storeKey(ctx!));storage.remove(`${storeKey(ctx!)}:messages`);}
 return <MotionConfig reducedMotion="user"><div className={`app ${ctx.scenario.id}`}>
  <header className="topbar">
   <a href="/" className="wordmark"><Mark kind={ctx.scenario.id}/>{c.name}</a>
   <div className="app-location">{c.section}</div>
   <nav><a className="exchange-link" href={exchange.href} target="_blank" rel="noreferrer">Open exchange <ArrowUpRight size={16}/></a></nav>
  </header>
  <main className="workspace" id="main">
   <motion.aside className="context-panel" initial={{opacity:0,x:-8}} animate={{opacity:1,x:0}} transition={{duration:.35}}>
    <div className="context-heading"><span className="context-index">{ctx.scenario.id==='dating'?'01':ctx.scenario.id==='fashion'?'02':'03'}</span><span>{c.contextLabel}</span></div>
    <h1>{c.contextTitle}</h1><p className="context-description">{c.description}</p>
    <div className="scene-wrap"><Miniature kind={ctx.scenario.id}/></div>
    <dl className="context-facts">{c.contextRows.map(([term,value])=><div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
    <div className="context-footer"><MapPin size={15}/><span>{ctx.scenario.id==='fashion'?'Personal shopping':'San Francisco, California'}</span></div>
   </motion.aside>
   <motion.section className="conversation" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:.35,delay:.08}} aria-label={`${c.name} conversation`}>
    <div className="conversation-header"><div><div className="conversation-kicker">{c.name}</div><h2>{c.title}</h2></div><button className="new-chat" title="Start a new conversation" aria-label="Start a new conversation" disabled={!!pending||sending||recovering} onClick={reset}><Plus size={18}/><span>New chat</span></button></div>
    <div className="chat-scroll" ref={scroll} onScroll={()=>{const el=scroll.current;if(el)followScroll.current=el.scrollHeight-el.scrollTop-el.clientHeight<110;}}>
     <div className="conversation-start"><span>Today</span><span>{ctx.scenario.id==='dating'?'Planning with Alex':ctx.scenario.id==='fashion'?'Your shopping brief':'Planning for two'}</span></div>
     <div className="message assistant"><div className="message-byline"><Mark kind={ctx.scenario.id}/><span>{c.name}</span></div><p>{c.welcome}</p><p>{c.followup}</p></div>
     <AnimatePresence initial={false}>{messages.map((m,i)=><motion.div className={`message ${m.role}`} key={i} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,height:0}} transition={{duration:.2}}><p>{m.text}</p></motion.div>)}</AnimatePresence>
     {!messages.length&&!recovering&&!recoveryFailed&&<motion.button whileHover={{x:3}} whileTap={{scale:.99}} className="suggestion" onClick={()=>send(ctx.scenario.prompt)}>{c.button}<ArrowUpRight size={17}/></motion.button>}
     <AnimatePresence mode="wait">{(sending||pending)&&<StatusNote key={auction?.status||'sending'} status={auction?.status} sending={sending} pendingText={c.pending}/>}</AnimatePresence>
     {pending&&<a className="pending-exchange" href={exchange.href} target="_blank" rel="noreferrer">View this request in the exchange <ArrowUpRight size={13}/></a>}
     {recovering&&<div className="recovery-note" role="status"><RefreshCw size={16}/><span>Restoring your conversation…</span></div>}
     {(recoveryFailed||connectionLost)&&<div className="recovery-note" role="status"><span>{recoveryFailed?'Your previous search is saved. Reconnect to continue.':'Connection lost. Your search continues; reconnecting…'}</span>{recoveryFailed&&<button onClick={()=>void restore(ctx)}>Reconnect <RefreshCw size={14}/></button>}</div>}
     {auction?.status==='completed'&&winner&&place&&<motion.div ref={resultCard} className="recommendation" role="status" aria-label="Your recommendation is ready" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:.35}}>
      <p className="recommendation-lead">{c.result}</p>
      <article className="offer-card">
       <div className="offer-heading"><div className="offer-category"><Icon size={16}/>{ctx.scenario.id==='dating'?'Coffee for two':ctx.scenario.id==='fashion'?'Women’s sneakers':'Experience for two'}</div><Check size={17}/></div>
       <div className="offer-main"><div><h3>{winner.brand_name}</h3><p className="item-name">{place.item}</p></div><div className="offer-price"><motion.strong initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} transition={{delay:.12}}>{money(winner.effective_price_cents)}</motion.strong>{winner.discount_cents>0&&<del>{money(winner.base_price_cents)}</del>}</div></div>
       <p className="fit-reason">{brand?.description||place.description}</p>
       {winner.discount_cents>0&&<div className="savings-row"><span>Your offer</span><strong>{money(winner.discount_cents)} off the base price</strong></div>}
       <button className="code-button" onClick={()=>void copyCode()}><span>{copied?'Code copied':'Demo discount code'}</span><strong>{place.code}</strong>{copied?<Check size={15}/>:<span className="copy-label">Copy</span>}</button>
       <motion.button whileHover={{y:-1}} whileTap={{scale:.99}} className="merchant-button" onClick={click} disabled={clicking||place.status==='expired'}>{place.status==='expired'?'Offer expired · ask again':clicking?'Opening…':ctx.scenario.id==='dating'?'View café':ctx.scenario.id==='fashion'?'View sneakers':'View experience'}<ArrowUpRight size={18}/></motion.button>
       <button className="detail-toggle" aria-expanded={details} onClick={()=>setDetails(!details)}>Offer details <ChevronRight size={14} className={details?'rotated':''}/></button>
       {details&&<div className="offer-details"><p>Fictional campaign and discount. This demo code cannot be redeemed. {(brand?.price_kind||place.price_kind)==='demo_quote'?'The base price is a simulated quote.':'Price is a dated product snapshot; current price and size availability are unverified.'}</p><p>{auction.payment_mode==='sandbox'?'Advertising payments use Stripe sandbox money.':'Advertising payments are simulated.'}</p><a href={brand?.source_url||place.destination} target="_blank" rel="noreferrer">Merchant information <ArrowUpRight size={12}/></a></div>}
      </article>
     </motion.div>}
     {auction&&['failed','cancelled'].includes(auction.status)&&<div className="message assistant"><p>{auction.status==='cancelled'?'This search was cancelled. You can start a new request.':'This search couldn’t be completed. Please try again.'}</p></div>}
     {auction?.status==='completed'&&!winner&&<div className="message assistant"><p>No recommendation is available for this request. Try a different preference.</p></div>}
     {error&&<div className="error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}<div ref={bottom}/>
    </div>
    <div className="composer-area"><form className="composer" onSubmit={e=>{e.preventDefault();void send(input);}}><textarea disabled={recovering||recoveryFailed} aria-label="Your message" value={input} onChange={e=>setInput(e.target.value)} placeholder={c.hint} rows={2} maxLength={2000} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send(input);}}}/><div><span>{recovering?'Restoring conversation':pending?'Your search is in progress':'Enter to send'}</span><button aria-label="Send message" type="submit" disabled={!input.trim()||sending||!!pending||recovering||recoveryFailed}><ArrowUp size={19}/></button></div></form><div className="conversation-footnote"><span className={connectionLost?'connection-status disconnected':'connection-status'}><i/>{connectionLost?'Reconnecting':pending?'Request in progress':'Connected'}</span><span>Demo · fictional offers · {ctx.payment_mode==='sandbox'?'Stripe test money':'simulated money'}</span></div></div>
   </motion.section>
  </main>
  <footer><span>{ctx.scenario.id==='dating'?'Wavelength-inspired. No affiliation.':'San Francisco, California.'}</span><a href={exchange.href} target="_blank" rel="noreferrer">Recommendations through Accord <ArrowUpRight size={13}/></a></footer>
 </div></MotionConfig>;
}
createRoot(document.getElementById('root')!).render(<App/>);
