import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { ArrowUp, ArrowUpRight, Check, ChevronRight, Compass, Heart, MapPin, Plus, RefreshCw, Sparkles, Sprout, X } from 'lucide-react';
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
  <div className="search-signal" aria-hidden="true"><span/><Sparkles size={16}/></div>
  <div><span className="message-name">{label}</span><p>{status==='paused'?'Your companion will pick this up when the search continues.':pendingText}</p>
  <div className={`thinking-dots ${status==='paused'?'resting':''}`} aria-hidden="true"><i/><i/><i/></div></div>
 </motion.div>;
}
const content={
 dating:{name:'Wavelength',eyebrow:'A LITTLE CHEMISTRY. A REAL CONNECTION.',headline:<>Good things<br/>start with <em>hello.</em></>,description:'You bring yourself. We’ll help with the rest.',assistant:'Your wingmate',welcome:'You and Alex both love slow weekends, good coffee, and getting a little lost in the city. There’s something here.',followup:'You’ve made the connection. Want me to find a spot for your first coffee together?',hint:'Tell me what your perfect first date feels like…',button:'Find our coffee spot',tag:'A connection worth exploring',details:['San Francisco','Coffee, always','Slow Sundays'],pending:'Finding a little place for your first hello…',result:'A good place to start',icon:Heart},
 fashion:{name:'Thread',eyebrow:'LESS SCROLLING. MORE YOU.',headline:<>Find your<br/><em>everyday</em> thing.</>,description:'A thoughtful wardrobe starts with what you actually do.',assistant:'Your style companion',welcome:'A lot of walking, a little fog, and a wardrobe that has to keep up. Let’s find a pair you’ll reach for every day.',followup:'You mentioned comfort and easy cleaning. I can find a few women’s sneakers that fit your SF routine.',hint:'Tell me what you’re looking for…',button:'Find my everyday sneakers',tag:'Built around your everyday',details:['City walking','Easy to care for','Comfort first'],pending:'Finding the pair that fits your everyday…',result:'Meet your next everyday pair',icon:Sprout},
 outings:{name:'Roam',eyebrow:'THE CITY HAS A FEW IDEAS.',headline:<>Make room<br/>for <em>unexpected.</em></>,description:'Your next good story is somewhere out there.',assistant:'Your local companion',welcome:'Art that makes you stop. Science you can get your hands on. San Francisco is a good place to be curious together.',followup:'Let’s find an outing that combines what you both love. What kind of evening are you imagining?',hint:'Where should our curiosity take us?…',button:'Find our next outing',tag:'For your curious side',details:['San Francisco','Art & science','Something different'],pending:'Finding something worth going out for…',result:'This has your kind of energy',icon:Compass},
};

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
 useEffect(()=>{api<Context>('/api/context').then(c=>{setCtx(c);document.title=`${content[c.scenario.id].name} — your personal companion`;void restore(c);}).catch(e=>setError(e.message));},[]);
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
  const id=requestAnimationFrame(()=>bottom.current?.scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'nearest'}));
  return()=>cancelAnimationFrame(id);
 },[messages.length,auction?.status,sending,reducedMotion]);
 if(!ctx)return <main className="loading"><div className="loading-mark"><Sparkles size={24}/></div><p>{error||'A little inspiration is on its way…'}</p>{error&&<button onClick={()=>location.reload()}>Try again</button>}</main>;
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
  <header className="topbar"><a href="/" className="wordmark"><Icon size={25} strokeWidth={1.5}/>{c.name}<span className="wordmark-dot">.</span></a><nav><span className="city"><MapPin size={13}/> San Francisco</span><span className="demo-pill">DEMO EXPERIENCE</span><a className="exchange-link" href={exchange.href} target="_blank" rel="noreferrer">Open exchange <ArrowUpRight size={14}/></a></nav></header>
  <main className="layout"><motion.section className="intro" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:.55}}><p className="eyebrow">{c.eyebrow}</p><h1>{c.headline}</h1><p className="intro-description">{c.description}</p><div className="scene" aria-hidden="true"><div className="scene-orbit orbit-one"/><div className="scene-orbit orbit-two"/>{ctx.scenario.id==='dating'?<><div className="person-card person-one"><div className="portrait portrait-one"><span>A</span><div className="portrait-shape"/></div><div><strong>Alex</strong><span>Curious about everything</span></div></div><div className="person-card person-two"><div className="portrait portrait-two"><span>Y</span><div className="portrait-shape"/></div><div><strong>You</strong><span>Ready for a real hello</span></div></div><div className="connection-icon"><Heart size={25} fill="currentColor" strokeWidth={0}/></div><span className="scene-note">a little spark goes a long way</span></>:ctx.scenario.id==='fashion'?<><div className="style-card"><span className="card-number">YOUR DAILY ROTATION / 01</span><div className="shoe"><div className="shoe-top"/><div className="shoe-sole"/><i/><i/><i/></div><span className="style-card-footer">THE EVERYDAY EDIT <ArrowUpRight size={15}/></span></div><div className="fabric-swatch swatch-one"/><div className="fabric-swatch swatch-two"/><span className="scene-note">wear it. love it. repeat.</span></>:<><div className="city-grid"/><div className="outing-ticket"><span>SAN FRANCISCO</span><Compass size={50} strokeWidth={1}/><strong>Stay<br/><em>curious.</em></strong><span>37.7749° N, 122.4194° W</span></div><div className="map-pin pin-one"><MapPin size={24} fill="currentColor"/></div><div className="map-pin pin-two"><Sparkles size={21}/></div><span className="scene-note">take the interesting way</span></>}</div><div className="preference-box"><span className="small-label">{c.tag}</span><div className="preference-tags">{c.details.map(d=><span key={d}>{d}</span>)}</div></div><p className="bottom-note">A personal AI experience, connected through Accord.</p></motion.section>
  <motion.section className="chat-panel" initial={{opacity:0,y:18}} animate={{opacity:1,y:0}} transition={{duration:.55,delay:.08}} aria-label={`${c.name} conversation`}><div className="chat-heading"><div className="assistant-avatar"><Icon size={19}/></div><div><h2>{c.assistant}</h2><span><i className={connectionLost?'offline':''}/>{connectionLost?'Reconnecting…':recovering?'Picking up where you left off':pending?'Finding your next good thing':'Here for the good stuff'}</span></div><button className="icon-button" title="Start a new conversation" aria-label="Start a new conversation" disabled={!!pending||sending||recovering} onClick={reset}><Plus size={19}/></button></div><div className="chat-scroll" ref={scroll} onScroll={()=>{const el=scroll.current;if(el)followScroll.current=el.scrollHeight-el.scrollTop-el.clientHeight<110;}}><div className="chat-date">TODAY, A LITTLE POSSIBILITY</div><div className="message assistant"><span className="message-name">{c.name}</span><p>{c.welcome}</p><p>{c.followup}</p></div><AnimatePresence initial={false}>{messages.map((m,i)=><motion.div className={`message ${m.role}`} key={i} initial={{opacity:0,y:12,scale:.98}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,height:0}} transition={{type:'spring',stiffness:350,damping:30}}><p>{m.text}</p></motion.div>)}</AnimatePresence>{!messages.length&&!recovering&&!recoveryFailed&&<motion.button whileHover={{y:-2}} whileTap={{scale:.98}} className="suggestion" onClick={()=>send(ctx.scenario.prompt)}><Sparkles size={15}/>{c.button}<ChevronRight size={15}/></motion.button>}<AnimatePresence mode="wait">{(sending||pending)&&<StatusNote key={auction?.status||'sending'} status={auction?.status} sending={sending} pendingText={c.pending}/>}</AnimatePresence>{pending&&<a className="pending-exchange" href={exchange.href} target="_blank" rel="noreferrer">Follow your request in the exchange <ArrowUpRight size={12}/></a>}{recovering&&<div className="recovery-note" role="status"><RefreshCw size={14}/><span>Reopening your conversation…</span></div>}{(recoveryFailed||connectionLost)&&<div className="recovery-note" role="status"><span>{recoveryFailed?'Your previous search is saved. Let’s reconnect before starting another.':'The connection dropped. Your search continues; we’re reconnecting.'}</span>{recoveryFailed&&<button onClick={()=>void restore(ctx)}>Reconnect <RefreshCw size={12}/></button>}</div>}{auction?.status==='completed'&&winner&&place&&<motion.div className="recommendation" role="status" aria-label="Your recommendation is ready" initial={{opacity:0,y:20,scale:.97}} animate={{opacity:1,y:0,scale:1}} transition={{type:'spring',stiffness:220,damping:25}}><div className="recommendation-intro"><Sparkles size={16}/><span>{c.result}</span></div><div className="recommendation-art" style={{'--brand-color':brand?.color||'#97a88b'} as React.CSSProperties}><span className="brand-monogram">{brand?.initials||winner.brand_name.slice(0,2)}</span><span className="recommendation-category">{ctx.scenario.id==='dating'?'COFFEE & CONVERSATION':ctx.scenario.id==='fashion'?'YOUR EVERYDAY EDIT':'A LITTLE DISCOVERY'}</span><div className="art-circle"/></div><div className="recommendation-body"><h3>{winner.brand_name}</h3><p className="item-name">{place.item}</p><p className="fit-reason">{brand?.description}</p><div className="price-line"><motion.strong initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:.15}}>{money(winner.effective_price_cents)}</motion.strong>{winner.discount_cents>0&&<><del>{money(winner.base_price_cents)}</del><span>Save {money(winner.discount_cents)}</span></>}</div><button className="code-button" onClick={()=>void copyCode()}><span>{copied?'COPIED TO CLIPBOARD':'YOUR DEMO CODE'}</span><strong>{place.code}</strong>{copied?<Check size={15}/>:<span className="copy-label">COPY</span>}</button><motion.button whileHover={{y:-1}} whileTap={{scale:.985}} className="merchant-button" onClick={click} disabled={clicking||place.status==='expired'}>{place.status==='expired'?'Offer expired · ask again':clicking?'Opening…':ctx.scenario.id==='dating'?'Take a look':ctx.scenario.id==='fashion'?'Explore this pair':'Explore this outing'}<ArrowUpRight size={17}/></motion.button><button className="detail-toggle" aria-expanded={details} onClick={()=>setDetails(!details)}>About this recommendation <ChevronRight size={12} className={details?'rotated':''}/></button>{details&&<div className="offer-details"><p>Fictional campaign and discount. This demo code cannot be redeemed. {brand?.price_kind==='demo_quote'?'The base price is a simulated quote.':'Price is a dated product snapshot; current price and size availability are unverified.'}</p><p>{auction.payment_mode==='sandbox'?'Advertising payments use Stripe sandbox money.':'Advertising payments are simulated.'}</p><a href={brand?.source_url||place.destination} target="_blank" rel="noreferrer">Merchant information <ArrowUpRight size={11}/></a></div>}</div></motion.div>}{auction&&['failed','cancelled'].includes(auction.status)&&<div className="message assistant"><p>{auction.status==='cancelled'?'That search was cancelled. Let’s try a fresh idea.':'I couldn’t finish this search. Please try again in a moment.'}</p></div>}{auction?.status==='completed'&&!winner&&<div className="message assistant"><p>I couldn’t find an available recommendation this time. Try a different request.</p></div>}{error&&<div className="error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={14}/></button></div>}<div ref={bottom}/></div><form className="composer" onSubmit={e=>{e.preventDefault();void send(input);}}><textarea disabled={recovering||recoveryFailed} aria-label="Your message" value={input} onChange={e=>setInput(e.target.value)} placeholder={c.hint} rows={2} maxLength={2000} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send(input);}}}/><div><span>{recovering?'Restoring your conversation':pending?'You can write your next thought while I look':'Enter to send · Shift + Enter for a new line'}</span><button aria-label="Send message" type="submit" disabled={!input.trim()||sending||!!pending||recovering||recoveryFailed}><ArrowUp size={19}/></button></div></form><p className="chat-disclaimer">Simulated app · fictional offers · {ctx.payment_mode==='sandbox'?'Stripe test money':'simulated money'}</p></motion.section></main><footer><span>Thoughtfully connected.</span><span>{ctx.scenario.id==='dating'?'Wavelength-inspired concept · no affiliation':'An independent demo experience'}</span><a href={exchange.href} target="_blank" rel="noreferrer">Powered by Accord <ArrowUpRight size={11}/></a></footer></div></MotionConfig>;
}
createRoot(document.getElementById('root')!).render(<App/>);
