import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, KeyRound, Plus, RefreshCw, Terminal, X } from 'lucide-react';
import type { Brand, ScenarioId } from '../shared/types';
import './external-brands.css';

interface InvitedAgent {
  brand: Brand;
  active: boolean;
  created_at: string;
  last_seen_at?: string;
  revoked: boolean;
}
interface Props {
  request<T>(path: string, options?: RequestInit): Promise<T>;
  onChanged: () => Promise<unknown>;
}
interface IssuedCredential { brand: Brand; token: string; workspace_id: string }
const INITIAL = {
  name: '', scenario: 'dating' as ScenarioId, item: '', description: '',
  basePrice: '16.00', maxCpc: '1.50', maxDiscount: '5.00', sourceUrl: '',
  facts: '', tags: '', code: '',
  strategy: 'Compete on customer value while staying within campaign limits.',
};
const scenarioNames: Record<ScenarioId, string> = { dating: 'Cafés / dating', fashion: 'Fashion', outings: 'SF outings' };
function cents(value: string, label: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error(`${label} must be a dollar amount with at most two decimal places.`);
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} is too large.`);
  return result;
}
function message(error: unknown) { return error instanceof Error ? error.message : 'The request could not be completed.'; }
function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }

export default function ExternalBrands({ request, onChanged }: Props) {
  const [agents, setAgents] = useState<InvitedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(INITIAL);
  const [busy, setBusy] = useState<string | null>(null);
  const [credential, setCredential] = useState<IssuedCredential | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await request<{ agents: InvitedAgent[] }>('/v1/brand-agents');
    setAgents(response.agents);
  }, [request]);

  useEffect(() => {
    let disposed = false;
    load().catch(reason => { if (!disposed) setError(message(reason)); }).finally(() => { if (!disposed) setLoading(false); });
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load().catch(() => {});
    }, 15_000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [load]);

  const refresh = async () => {
    setError('');
    setLoading(true);
    try { await load(); } catch (reason) { setError(message(reason)); }
    finally { setLoading(false); }
  };
  const setField = <K extends keyof typeof INITIAL>(key: K, value: typeof INITIAL[K]) => setForm(current => ({ ...current, [key]: value }));
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setBusy('create');
    try {
      const basePrice = cents(form.basePrice, 'Base price');
      const maxCpc = cents(form.maxCpc, 'Maximum CPC');
      const maxDiscount = cents(form.maxDiscount, 'Maximum discount');
      if (basePrice <= 0 || maxCpc <= 0) throw new Error('Base price and maximum CPC must be greater than zero.');
      if (basePrice > 1_000_000) throw new Error('Base price cannot exceed $10,000.00.');
      if (maxCpc > 10_000) throw new Error('Maximum CPC cannot exceed $100.00.');
      if (maxDiscount > basePrice) throw new Error('Maximum discount cannot exceed the base price.');
      const facts = form.facts.split('\n').map(line => line.trim()).filter(Boolean);
      const tags = form.tags.split(',').map(tag => tag.trim()).filter(Boolean);
      if (facts.length > 12 || facts.some(fact => fact.length > 500)) throw new Error('Use up to 12 facts, with at most 500 characters per fact.');
      if (tags.length > 12 || tags.some(tag => tag.length > 64)) throw new Error('Use up to 12 tags, with at most 64 characters per tag.');
      const result = await request<IssuedCredential>('/v1/brand-agents', {
        method: 'POST', body: JSON.stringify({
          name: form.name.trim(), scenario: form.scenario, item: form.item.trim(),
          description: form.description.trim(), base_price_cents: basePrice,
          source_url: form.sourceUrl.trim(),
          facts, tags,
          code: form.code.trim(), max_cpc_cents: maxCpc, max_discount_cents: maxDiscount,
          strategy: form.strategy.trim(),
        }),
      });
      setCredential(result);
      setRevealed(false);
      setCopied('');
      setFormOpen(false);
      setForm(INITIAL);
      await Promise.all([load(), onChanged()]);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(null); }
  };
  const revoke = async (id: string) => {
    setError('');
    setBusy(id);
    try {
      await request(`/v1/brand-agents/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
      if (credential?.brand.id === id) setCredential(null);
      setConfirmRevoke(null);
      await Promise.all([load(), onChanged()]);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(null); }
  };
  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(label); }
    catch { setError('Clipboard access was blocked. Reveal the token and copy it manually.'); }
  };
  const environment = credential ? [
    `export ACCORD_EXCHANGE_URL=${shellQuote(window.location.origin)}`,
    `export ACCORD_WORKSPACE_ID=${shellQuote(credential.workspace_id)}`,
    `export ACCORD_AGENT_TOKEN=${shellQuote(credential.token)}`,
    '# Also configure your own OPENAI_API_KEY locally.',
    'node scripts/external-brand-agent.mjs',
  ].join('\n') : '';

  return <section className="external-brands" aria-labelledby="external-brands-heading">
    <header className="external-brands-header">
      <div><span className="eyebrow">INVITE-ONLY ACCESS</span><h2 id="external-brands-heading">External brand agents</h2><p>Issue a scoped credential so a brand can run its own bidding agent.</p></div>
      <div className="external-brands-actions">
        <button className="icon-btn" type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh external agents"><RefreshCw size={15} /></button>
        <button className="button secondary" type="button" disabled={!!credential || !!busy} onClick={() => setFormOpen(!formOpen)} aria-expanded={formOpen}>{formOpen ? <X size={14} /> : <Plus size={14} />}{formOpen ? 'Close form' : 'Invite brand agent'}</button>
      </div>
    </header>
    {error && <p className="external-brands-error" role="alert">{error}</p>}
    {credential && <div className="external-credential" role="region" aria-label="New brand credential">
      <div className="external-credential-title"><KeyRound size={16} /><h3>Credential issued · {credential.brand.name}</h3><span className="tiny-pill">Shown once</span></div>
      <p>Save this token now and share it privately with the invited brand. It will not be shown again after you dismiss this panel or leave the page.</p>
      <div className="external-secret-row">
        <input aria-label="Brand agent token" type={revealed ? 'text' : 'password'} value={credential.token} readOnly autoComplete="off" spellCheck={false} />
        <button className="button secondary" type="button" onClick={() => setRevealed(!revealed)} aria-pressed={revealed}>{revealed ? 'Hide' : 'Reveal'}</button>
        <button className="button secondary" type="button" onClick={() => void copy(credential.token, 'token')}>{copied === 'token' ? <Check size={13} /> : <Copy size={13} />} Copy token</button>
      </div>
      <dl><div><dt>Brand ID</dt><dd>{credential.brand.id}</dd></div><div><dt>Workspace</dt><dd>{credential.workspace_id}</dd></div></dl>
      <div className="external-run-header"><span><Terminal size={14} /> Run from the Accord repository</span><button className="text-button" type="button" onClick={() => void copy(environment, 'environment')}>{copied === 'environment' ? <Check size={13} /> : <Copy size={13} />}{copied === 'environment' ? 'Copied with token' : 'Copy commands with token'}</button></div>
      <pre>{environment.replace(shellQuote(credential.token), revealed ? shellQuote(credential.token) : "'<your issued token>'")}</pre>
      <p>The live GPT client requires the brand’s own <code>OPENAI_API_KEY</code>, configured on their machine. Do not paste it into this console or send it to the exchange.</p>
      <p className="external-credential-next">Next: fund the campaign below, then activate it. The brand’s client polls for bidding turns and submits offers within the round deadline. This workspace uses sandbox payments; discount codes are illustrative.</p>
      <button className="button secondary" type="button" onClick={() => { setCredential(null); setRevealed(false); setCopied(''); }}>I saved the token · dismiss</button>
      {copied && <span className="external-copy-status" role="status">{copied === 'token' ? 'Token copied.' : 'Commands copied with the token.'}</span>}
    </div>}
    {formOpen && <form className="external-invite-form" onSubmit={event => void create(event)}>
      <div className="external-form-grid">
        <label>Brand name<input required maxLength={100} value={form.name} onChange={event => setField('name', event.target.value)} placeholder="Your invited merchant" /></label>
        <label>Marketplace<select value={form.scenario} onChange={event => setField('scenario', event.target.value as ScenarioId)}>{Object.entries(scenarioNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Product or quoted experience<input required maxLength={160} value={form.item} onChange={event => setField('item', event.target.value)} placeholder="Two drinks at your café" /></label>
        <label>Merchant source URL<input required type="url" value={form.sourceUrl} onChange={event => setField('sourceUrl', event.target.value)} placeholder="https://your-merchant.com/menu" /></label>
        <label className="external-span-two">Description<textarea required rows={2} maxLength={1500} value={form.description} onChange={event => setField('description', event.target.value)} placeholder="Describe the item and the experience it offers." /></label>
        <label>Catalog facts · one per line<textarea required rows={3} maxLength={3000} value={form.facts} onChange={event => setField('facts', event.target.value)} placeholder={'Outdoor seating\nLocated in the Mission'} /></label>
        <label>Tags · comma-separated<input maxLength={500} value={form.tags} onChange={event => setField('tags', event.target.value)} placeholder="coffee, casual, outdoor" /><span className="external-field-note">Merchant-provided catalog facts are unverified. Include a source URL and accurate pricing.</span></label>
        <div className="external-money-fields external-span-two">
          <label>Base price · USD<input required inputMode="decimal" value={form.basePrice} onChange={event => setField('basePrice', event.target.value)} /></label>
          <label>Maximum CPC · USD<input required inputMode="decimal" value={form.maxCpc} onChange={event => setField('maxCpc', event.target.value)} /></label>
          <label>Maximum discount · USD<input required inputMode="decimal" value={form.maxDiscount} onChange={event => setField('maxDiscount', event.target.value)} /></label>
          <label>Illustrative discount code<input required maxLength={64} pattern="[A-Za-z0-9_\-]+" title="Letters, numbers, hyphens, and underscores only" value={form.code} onChange={event => setField('code', event.target.value)} placeholder="BRAND-PILOT" /></label>
        </div>
        <label className="external-span-two">Campaign strategy<textarea required rows={2} maxLength={2000} value={form.strategy} onChange={event => setField('strategy', event.target.value)} /></label>
      </div>
      <footer><p>Creates an inactive campaign with a $0 balance. The credential is restricted to this brand’s agent protocol.</p><button className="button primary" type="submit" disabled={!!busy}>{busy === 'create' ? 'Issuing credential…' : 'Create invitation'}</button></footer>
    </form>}
    <div className="external-agent-list">
      <p className="external-empty">The brand runs its client on its own machine with its own OpenAI API key. Only the scoped Accord credential connects it to this exchange; provider keys stay with the brand.</p>
      {loading && agents.length === 0 ? <p className="external-empty">Loading invited agents…</p> : agents.length === 0 ? <p className="external-empty">No external agents invited. Create an invitation to connect a brand’s own client.</p> : <div className="table-scroll"><table><thead><tr><th>BRAND</th><th>MARKETPLACE</th><th>ACCESS / CAMPAIGN</th><th>LAST CLIENT CONTACT</th><th><span className="external-sr-only">Actions</span></th></tr></thead><tbody>{agents.map(agent => <tr key={agent.brand.id}>
        <td><b>{agent.brand.name}</b><small>{agent.brand.id}</small></td><td>{scenarioNames[agent.brand.scenario]}</td>
        <td><span className={`external-agent-status ${agent.revoked ? 'revoked' : agent.active ? 'active' : ''}`}>{agent.revoked ? 'Revoked' : agent.active ? 'Active' : 'Inactive · fund & activate'}</span></td>
        <td>{agent.last_seen_at ? <time dateTime={agent.last_seen_at} title={new Date(agent.last_seen_at).toLocaleString()}>{new Date(agent.last_seen_at).toLocaleTimeString()}</time> : 'Awaiting first poll'}</td>
        <td>{!agent.revoked && (confirmRevoke === agent.brand.id ? <div className="external-revoke-confirm"><span>Disable key and future participation? Committed offers remain eligible.</span><button className="text-button external-revoke" type="button" disabled={!!busy} onClick={() => void revoke(agent.brand.id)}>{busy === agent.brand.id ? 'Revoking…' : 'Revoke'}</button><button className="text-button" type="button" onClick={() => setConfirmRevoke(null)}>Keep</button></div> : <button className="text-button external-revoke" type="button" disabled={!!busy} onClick={() => setConfirmRevoke(agent.brand.id)}>Revoke access</button>)}</td>
      </tr>)}</tbody></table></div>}
    </div>
  </section>;
}
