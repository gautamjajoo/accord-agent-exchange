import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import './operator-access.css';

export default function OperatorAccess({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function signIn(value: string) {
    const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: value }) });
    if (!response.ok) throw new Error(response.status === 401 ? 'This access token was not recognized.' : 'Could not establish a session. Please try again.');
    const result = await response.json() as { authenticated: boolean };
    if (!result.authenticated) throw new Error('Could not establish a session.');
    sessionStorage.removeItem('accord-admin-token');
    setToken(''); setAuthenticated(true);
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/session', { cache: 'no-store' });
        if (!response.ok) throw new Error('The exchange is unavailable. Reload to reconnect.');
        const session = await response.json() as { authenticated: boolean };
        if (cancelled) return;
        if (session.authenticated) setAuthenticated(true);
        else {
          const oldToken = sessionStorage.getItem('accord-admin-token');
          if (oldToken) { try { await signIn(oldToken); } catch { sessionStorage.removeItem('accord-admin-token'); } }
        }
      } catch (e) { if (!cancelled) setError((e as Error).message); }
      finally { if (!cancelled) setChecking(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!token.trim()) return;
    setBusy(true); setError('');
    try { await signIn(token.trim()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (authenticated) return <>{children}</>;
  return <main className="operator-access">
    <header><a href="/" className="access-brand"><span aria-hidden="true">a.</span>accord</a><span>Exchange infrastructure</span></header>
    <div className="access-layout"><section className="access-introduction"><span className="access-overline">Operator console</span><h1>Every offer.<br/>Every decision.<br/><em>On the record.</em></h1><p>Operate campaigns, inspect agent negotiations, and follow advertising payments from reservation to settlement.</p><div className="access-protocol"><span>Publisher request</span><i/><span>Agent exchange</span><i/><span>Settlement</span></div></section>
      <section className="access-form-panel"><LockKeyhole size={22}/><h2>Sign in to your workspace</h2><p>Use your operator access token. Your workspace is private. Example integrations run in a separate test workspace.</p>{checking ? <div className="access-checking" role="status">Checking session…</div> : <form onSubmit={submit}><label htmlFor="operator-token">Operator access token</label><input id="operator-token" name="operator-token" type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" placeholder="Enter your access token" required disabled={busy}/>{error && <p className="access-error" role="alert">{error}</p>}<button type="submit" disabled={busy || !token.trim()}>{busy ? 'Signing in…' : 'Open console'}<ArrowRight size={16}/></button><small>Session expires after 8 hours. Credentials stay out of request logs.</small></form>}</section></div>
    <footer><span>Accord exchange</span><span>Authenticated operator access</span></footer>
  </main>;
}
