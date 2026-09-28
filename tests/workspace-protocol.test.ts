import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Auction, ScenarioId } from '../src/shared/types';

vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
vi.mock('../src/server/agents', () => ({ assessFits: vi.fn(), decideOffer: vi.fn() }));
import { harness, closeHarnesses } from './workspace-harness';

const request = (scenario: ScenarioId) => ({ scenario, intent: `${scenario} preference`, preferences: [scenario], mode: 'live' as const, payment_mode: 'simulation' as const });
afterEach(() => closeHarnesses());

describe('shared presentation stage protocol', () => {
  it('runs one request per consumer concurrently with distinct identities and preferences', async () => {
    const h = harness();
    const auctions = await Promise.all((['dating', 'fashion', 'outings'] as const).map(scenario => h.workspace.start(request(scenario))));
    expect(new Set(auctions.map(a => a.id)).size).toBe(3);
    expect(auctions.map(a => a.publisher_id)).toEqual(['wavelength', 'wardrobe', 'cityguide']);
    for (const a of auctions) {
      expect(a.preferences).toEqual([a.scenario]);
      expect(a.bidders).toHaveLength(3);
      expect(a.bidders.every(b => b.brand.scenario === a.scenario)).toBe(true);
      expect(h.get<Auction>('auction', a.id)?.intent).toBe(`${a.scenario} preference`);
    }
  });
  it('enforces the active request cap atomically and frees a slot after cancellation', async () => {
    const h = harness();
    const starts = await Promise.allSettled(Array.from({ length: 4 }, () => h.workspace.start(request('dating'))));
    const accepted = starts.filter(r => r.status === 'fulfilled');
    expect(accepted).toHaveLength(3);
    expect(starts.filter(r => r.status === 'rejected')).toHaveLength(1);
    await h.workspace.action(accepted[0].value.id, 'cancel');
    const replacement = await h.workspace.start(request('fashion'));
    expect(replacement.scenario).toBe('fashion');
    expect((await h.workspace.listAuctions()).filter(a => ['assessing', 'running', 'paused'].includes(a.status))).toHaveLength(3);
  });
  it('rejects unavailable sandbox payments without persisting or silently downgrading the auction', async () => {
    const h = harness();
    await expect(h.workspace.start({ ...request('dating'), payment_mode: 'sandbox' })).rejects.toThrow('configured Stripe credentials');
    expect(await h.workspace.listAuctions()).toEqual([]);
    const a = await h.workspace.start(request('dating'));
    expect(a.mode).toBe('live');
    expect(a.payment_mode).toBe('simulation');
  });
  it('keeps requested simulated money separate even when Stripe is configured', async () => {
    const h = harness(undefined, { STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_WEBHOOK_SECRET: 'whsec_mock' });
    const a = await h.workspace.start(request('dating'));
    expect(a.payment_mode).toBe('simulation');
    expect(a.bidders.every(b => b.campaign.balance_cents === 10000)).toBe(true);
  });
});
