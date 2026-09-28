import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, LockKeyhole, Radio, TrendingDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Auction, Round } from '../shared/types';

const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);

/** Values change only when an offer is committed; we never interpolate invented prices. */
export function AnimatedValue({value,className=''}:{value:string;className?:string}) {
  const reduced=useReducedMotion();
  return <span className={`animated-value ${className}`}><AnimatePresence initial={false} mode="popLayout"><motion.span key={value} initial={{opacity:0,y:reduced?0:10,filter:reduced?'none':'blur(2px)'}} animate={{opacity:1,y:0,filter:'blur(0px)'}} exit={{opacity:0,y:reduced?0:-8}} transition={{duration:reduced?0:.24,ease:[.22,1,.36,1]}}>{value}</motion.span></AnimatePresence></span>;
}

export function RoundStage({auction,round,replay}:{auction:Auction|null;round?:Round;replay:boolean}) {
  const reduced=useReducedMotion();
  const [now,setNow]=useState(Date.now());
  const negotiating=auction?.status==='running'&&!!auction.round_started_at&&!replay;
  const preparing=auction?.status==='running'&&!auction.round_started_at&&!replay;
  const assessing=auction?.status==='assessing'&&!replay;
  useEffect(()=>{if(!negotiating||!auction?.round_deadline)return;setNow(Date.now());const t=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(t);},[negotiating,auction?.round_deadline]);
  const seconds=auction?.round_deadline?Math.max(0,Math.ceil((Date.parse(auction.round_deadline)-now)/1000)):null;
  const current=replay?(round?.number||0):auction?.current_round||0;
  const committed=replay?(round?.number||0):auction?.rounds.length||0;
  const max=auction?.max_rounds||5;
  const remaining=auction?.bidders.filter(b=>!b.finalized&&!b.withdrawn).length||0;
  const complete=auction?.status==='completed'&&!replay;
  const title=replay?`Recorded round ${current}`:assessing?'Assessing personal fit':negotiating?`Round ${current} · collecting offers`:preparing?`Preparing round ${current}`:auction?.status==='paused'?'Negotiation paused':complete?'Negotiation complete':auction?.status==='cancelled'?'Negotiation cancelled.':auction?.status==='failed'?'Auction failed — retry available':'Ready for a request';
  const note=replay?'Original committed offers. No live decisions or billing.':assessing?'Your agent assesses personal fit before it sees any bids.':negotiating?`${remaining} ${remaining===1?'agent is':'agents are'} negotiating privately. The public board updates when the round closes.`:preparing?'The next bidding window is being prepared. Previous offers remain public.':auction?.status==='paused'?'The last completed round is held. Continue or accept its best offer.':complete?`Closed after ${committed} ${committed===1?'round':'rounds'} · ${(auction?.end_reason||'').replaceAll('_',' ')}.`:auction?'No further offers will be committed.':'A consumer request starts the negotiation. Up to five rounds. Accept early or let agents negotiate.';
  return <section className={`round-stage ${negotiating?'is-negotiating':''} ${complete?'is-agreed':''}`} aria-label="Auction round status">
    <div className="round-stage-heading"><div className="round-stage-symbol">{complete?<Check size={19}/>:negotiating?<LockKeyhole size={18}/>:<Radio size={18}/>}</div><div className="round-stage-copy"><span>{replay?'RECORDED EXCHANGE':negotiating?'SEALED BIDDING WINDOW':assessing?'USER AGENT · FIT ASSESSMENT':complete?'AUCTION CLOSED':'EXCHANGE PROTOCOL'}</span><AnimatePresence mode="wait" initial={false}><motion.h3 key={title} initial={{opacity:0,y:reduced?0:6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduced?0:-5}} transition={{duration:reduced?0:.18}}>{title}</motion.h3></AnimatePresence></div><div className="round-stage-counter"><b><AnimatedValue value={String(Math.min(current,max)).padStart(2,'0')}/></b><span>/ {String(max).padStart(2,'0')}<small>MAX ROUNDS</small></span></div></div>
    <div className="round-segments" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={committed} aria-label="Completed auction rounds">{Array.from({length:max},(_,i)=><div key={i} className={`${i<committed?'committed':''} ${negotiating&&i===current-1?'negotiating':''}`}><motion.span initial={false} animate={{scaleX:i<committed?1:0}} transition={{duration:reduced?0:.5,ease:[.22,1,.36,1]}}/>{negotiating&&i===current-1&&<i/>}</div>)}</div>
    <div className="round-stage-footer"><p>{note}</p>{negotiating&&seconds!==null&&<span className="deadline-label"><i/>{seconds>0?`${seconds}s window`:'Closing round'}</span>}</div>
  </section>;
}

export function LeadChange({auction,round}:{auction:Auction|null;round?:Round}) {
  const reduced=useReducedMotion();
  const previous=round&&round.number>1?auction?.rounds[round.number-2]:undefined;
  const changed=previous?.leader_id&&round?.leader_id&&previous.leader_id!==round.leader_id;
  const oldLeader=previous?.offers.find(o=>o.brand_id===previous.leader_id);
  const newLeader=round?.offers.find(o=>o.brand_id===round.leader_id);
  return <AnimatePresence initial={false}>{changed&&oldLeader&&newLeader&&<motion.div key={`${auction?.id}-${round?.number}-${newLeader.brand_id}`} className="lead-change-note" initial={{opacity:0,height:0,y:reduced?0:-8}} animate={{opacity:1,height:'auto',y:0}} exit={{opacity:0,height:0}} transition={{duration:reduced?0:.35,ease:[.22,1,.36,1]}} role="status"><TrendingDown size={16}/><div><span>THE LEAD CHANGED · ROUND {round?.number}</span><p><s>{oldLeader.brand_name}</s><ArrowRight size={12}/><b>{newLeader.brand_name}</b><span>now leads at {money(newLeader.effective_price_cents)} for the user.</span></p></div></motion.div>}</AnimatePresence>;
}
