import { useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Circle, Terminal, Waypoints } from 'lucide-react';
import type { Auction, AuditTrace, Bidder, Round } from '../shared/types';
import './live-operations.css';

const clock = (at: string) => new Date(at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const pretty = (payload: unknown) => JSON.stringify(payload, null, 2);
const endpoint = (url?: string) => { if (!url) return 'exchange'; try { const u = new URL(url, window.location.origin); return `${u.host === window.location.host ? '' : u.host}${u.pathname}`; } catch { return url; } };

function AgentTerminal({ bidder, auction, replay }: { bidder: Bidder; auction: Auction; replay: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const traces = (auction.trace || []).filter(t => t.actor === bidder.brand.id);
  const lastRequest = [...traces].reverse().find(t => t.kind === 'model.request');
  const waiting = !replay && auction.status === 'running' && !!lastRequest && !traces.some(t => t.correlation_id === lastRequest.correlation_id && t.kind !== 'model.request');
  const rounds = auction.rounds.filter(r => r.actions[bidder.brand.id]);
  const lastAction = rounds.at(-1)?.actions[bidder.brand.id];
  const timeline: ({ at: string; id: string; trace: AuditTrace; round?: never } | { at: string; id: string; round: Round; trace?: never })[] = [...traces.map(trace => ({ at: trace.at, id: trace.id, trace })), ...rounds.map(round => ({ at: round.completed_at, id: `round:${round.number}`, round }))];
  timeline.sort((a,b) => Date.parse(a.at) - Date.parse(b.at));
  const state = bidder.withdrawn ? 'withdrawn' : bidder.finalized ? 'final' : waiting ? 'request in flight' : auction.status === 'assessing' ? 'awaiting fit' : auction.status === 'running' ? 'connected' : 'idle';
  useEffect(() => { if (stick.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [traces.length, rounds.length, waiting]);
  return <section className={`agent-terminal ${waiting ? 'is-busy' : ''}`} aria-label={`${bidder.brand.name} agent terminal`}>
    <header><span className="agent-terminal-name"><Terminal size={13}/>{bidder.brand.id}</span><span className={`terminal-state ${waiting ? 'pending' : ''}`}><i/>{state}</span></header>
    <div className="terminal-session"><span>agent/{bidder.brand.id}</span><span>USD · CPC</span></div>
    <div ref={viewport} className="terminal-output" onScroll={e => { const v = e.currentTarget; stick.current = v.scrollHeight - v.scrollTop - v.clientHeight < 30; }} tabIndex={0} aria-label={`${bidder.brand.name} execution log`}>
      <div className="terminal-line terminal-muted"><span>session</span><p>{auction.id.slice(0, 8)} / {auction.mode === 'live' ? 'OpenAI Responses API' : 'Scripted simulation'}</p></div>
      {auction.status !== 'assessing' && <div className="terminal-line"><span>fit</span><p><b>{bidder.fit.score}/100</b> frozen before bidding</p></div>}
      {traces.length === 0 && rounds.length > 0 && <div className="terminal-line terminal-muted"><span>archive</span><p>Committed decisions. Transport capture was not enabled for this run.</p></div>}
      {timeline.map(entry => {
        if (entry.trace) { const t = entry.trace; return <div className={`terminal-event ${t.kind.endsWith('error') ? 'is-error' : ''}`} key={t.id}>
          <div className="terminal-line"><span>{clock(t.at)}</span><p>{t.kind === 'model.request' ? <><b className="terminal-command">POST</b> /v1/responses <small>r{t.round}</small></> : t.kind === 'model.response' ? <><b className="terminal-ok">{t.http_status ?? 'received'}</b> response · provisional <small>{t.duration_ms === undefined ? '' : `${t.duration_ms}ms`}</small></> : <><b>{t.kind.replaceAll('.', ' / ')}</b> {t.error || t.status}</>}</p></div>
          {t.kind === 'model.request' && <div className="terminal-line terminal-muted"><span>model</span><p>{t.model} <small>{t.correlation_id?.slice(0, 8)}</small></p></div>}
          {t.payload !== undefined && <details className="terminal-payload"><summary>{t.kind === 'model.request' ? 'Request payload' : 'Response payload'}<ChevronDown size={11}/></summary><pre>{pretty(t.payload)}</pre>{!!t.redacted?.length && <small>Redacted: {t.redacted.join(', ')}</small>}</details>}
        </div>; }
        const r = entry.round;
        const action = r.actions[bidder.brand.id];
        const offer = r.offers.find(o => o.brand_id === bidder.brand.id);
        return <div className="terminal-commit" key={entry.id}><div className="terminal-line"><span>{clock(r.completed_at)}</span><p><b className="terminal-round">round {r.number}</b> / {typeof action === 'string' ? action : action.action}{typeof action !== 'string' && action.action === 'submit' && action.final ? ' · final' : ''}</p></div>{offer && <pre>{JSON.stringify({ bid_cents: offer.bid_cents, discount_cents: offer.discount_cents, user_score: Number(offer.user_score.toFixed(3)) }, null, 2)}</pre>}</div>;
      })}
      {waiting && <div className="terminal-line terminal-wait"><span>pending</span><p>Waiting for provider response<span className="terminal-cursor">▍</span></p></div>}
      {!traces.length && !rounds.length && !waiting && <div className="terminal-line terminal-muted"><span>ready</span><p>{auction.status === 'assessing' ? 'Fit assessment must finish before bidding.' : 'Waiting for a bidding turn.'}</p></div>}
    </div>
    <footer><span>Last action</span><b>{typeof lastAction === 'string' ? 'error' : lastAction?.action || '—'}</b><span>Committed rounds</span><b>{rounds.length}</b></footer>
  </section>;
}

export function LiveOperations({ auction, replay }: { auction: Auction | null; replay: boolean }) {
  const [view, setView] = useState<'agents' | 'network'>('agents');
  const [expanded, setExpanded] = useState<string | null>(null);
  const trace = auction?.trace || [];
  const calls = trace.filter(t => t.kind === 'model.request');
  const responses = trace.filter(t => t.kind === 'model.response');
  const inflight = calls.filter(t => !trace.some(r => r.correlation_id === t.correlation_id && (r.kind === 'model.response' || r.kind === 'model.error'))).length;
  const live = !replay && (auction?.status === 'running' || auction?.status === 'assessing');
  return <section className="live-operations" aria-label="Live agent operations">
    <div className="operations-toolbar"><div className="operations-tabs" role="tablist" aria-label="Execution view"><button role="tab" aria-selected={view === 'agents'} className={view === 'agents' ? 'selected' : ''} onClick={() => setView('agents')}><Terminal size={14}/>Agent terminals</button><button role="tab" aria-selected={view === 'network'} className={view === 'network' ? 'selected' : ''} onClick={() => setView('network')}><Waypoints size={14}/>Network trace<span>{trace.length}</span></button></div><div className="operations-health"><span><Circle size={7} fill="currentColor"/>{live ? 'Polling · 1s' : replay ? 'Recorded state' : 'Session log'}</span><span>{responses.length}/{calls.length} responses{live && inflight ? ` · ${inflight} in flight` : ''}</span></div></div>
    {view === 'agents' ? <div className="agent-terminals">{auction?.bidders.length ? auction.bidders.map(b => <AgentTerminal key={`${auction.id}:${b.brand.id}`} bidder={b} auction={auction} replay={replay}/>) : [0,1,2].map(i => <section className="agent-terminal terminal-empty" key={i}><header><span><Terminal size={13}/>Agent {String(i+1).padStart(2,'0')}</span><span>standby</span></header><pre>Waiting for a consumer request.<br/><br/>Catalog and campaign selection<br/>happen when the request arrives.</pre></section>)}</div> : <div className="network-trace">
      <div className="network-columns"><span>Time / actor</span><span>Transport / event</span><span>Status</span><span>Duration</span><span>Correlation</span></div>
      {!trace.length && <div className="network-empty">{auction ? 'This auction predates transport capture. Start a new request to inspect real request and response events.' : 'Incoming requests and model calls appear here as they execute.'}</div>}
      {trace.map(t => <div className={`network-entry ${t.kind.includes('error') ? 'is-error' : ''}`} key={t.id}><button className="network-row" aria-expanded={expanded === t.id} onClick={() => setExpanded(expanded === t.id ? null : t.id)}><span><time>{clock(t.at)}</time><small>{t.actor}</small></span><span className="network-route">{t.kind.endsWith('request') ? <ArrowUpRight size={13}/> : <ArrowDownLeft size={13}/>}<b>{t.method || t.kind}</b><small>{endpoint(t.url)}</small></span><span className={t.http_status && t.http_status >= 400 || t.kind.includes('error') ? 'trace-bad' : t.kind.includes('response') || t.status === 'completed' ? 'trace-good' : ''}>{t.http_status || t.status || 'recorded'}</span><span>{t.duration_ms === undefined ? '—' : `${t.duration_ms} ms`}</span><span className="trace-id">{(t.provider_request_id || t.correlation_id || t.id).slice(0, 18)}<ChevronDown size={12}/></span></button>{expanded === t.id && <div className="network-detail"><div><b>{t.kind}</b>{t.model && <span>{t.provider} / {t.model}</span>}<span>{t.at}</span></div>{t.error && <p className="trace-bad">{t.error}</p>}<pre>{t.payload === undefined ? 'No payload recorded for this event.' : pretty(t.payload)}</pre>{!!t.redacted?.length && <p>Private fields omitted: {t.redacted.join(', ')}.</p>}<p>Event {t.id}{t.provider_request_id ? ` · Provider request ${t.provider_request_id}` : ''}</p></div>}</div>)}
    </div>}
    <div className="operations-footnote"><span>Server execution stream · actual persisted events</span><span>Credentials and private campaign limits are redacted</span></div>
  </section>;
}
