import { afterEach, describe, expect, it, vi } from 'vitest';
import consumerWorker from '../apps/consumers/worker';

const auctionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const placementId = '11111111-2222-3333-4444-555555555555';
const differentId = '22222222-3333-4444-5555-666666666666';
const workspaceId = '33333333-4444-5555-6666-777777777777';
const secret = 'publisher-key-server-only';
function fixture(overrides: Record<string, unknown> = {}) {
  return {
    id: auctionId, scenario: 'dating', publisher_id: 'wavelength', intent: 'Coffee date', preferences: ['quiet'],
    mode: 'live', payment_mode: 'simulation', status: 'completed', current_round: 3, max_rounds: 5,
    winner: { brand_id: 'sightglass', bid_cents: 99, discount_cents: 400 },
    placement: { id: placementId, auction_id: auctionId, code: 'SIGHTGLASS-DEMO' },
    bidders: [{ campaign: { strategy: 'PRIVATE_CAMPAIGN', max_cpc_cents: 999 } }],
    rounds: [{ offers: [{ private: 'PUBLIC_BOARD_NOT_FOR_CONSUMER' }] }],
    events: [{ message: 'INTERNAL_EVENT' }], trace: [{ kind: 'model.request', payload: 'OPERATOR_ONLY_TRACE' }], private_state: 'PRIVATE_STATE', ...overrides,
  };
}
function setup(responseData: unknown = fixture(), responseStatus = 200, envOverride: Record<string, unknown> = {}) {
  const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(responseData, { status: responseStatus }));
  const env = {
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('consumer HTML')) }, SCENARIO: 'dating' as const,
    EXCHANGE_URL: 'https://accord.example', EXCHANGE_API_KEY: secret, DEMO_WORKSPACE_ID: workspaceId,
    DEMO_PAYMENT_MODE: 'simulation' as const, ...envOverride,
  };
  const fetch = (path: string, options: { method?: string; data?: unknown; headers?: Record<string,string>; raw?: string } = {}) => {
    const { method = 'GET', data, raw, headers } = options;
    return consumerWorker.fetch(new Request(`https://wavelength.example${path}`, {
      method, headers, ...(raw !== undefined || data !== undefined ? { body: raw ?? JSON.stringify(data) } : {}),
    }), env as unknown as Parameters<typeof consumerWorker.fetch>[1]);
  };
  return { fetch, upstream, env };
}
afterEach(() => vi.restoreAllMocks());

describe('consumer publisher adapters', () => {
  it('serves the consumer application without calling the exchange', async () => {
    const { fetch, upstream } = setup();
    expect(await (await fetch('/')).text()).toBe('consumer HTML');
    expect(upstream).not.toHaveBeenCalled();
  });
  it('keeps publisher credentials on the server and fixes all commercial context', async () => {
    const { fetch, upstream } = setup();
    const response = await fetch('/api/auctions', { method: 'POST', data: {
      intent: 'A quiet cafe', preferences: ['quiet'], scenario: 'fashion', publisher_id: 'attacker', mode: 'simulation',
      payment_mode: 'sandbox', max_rounds: 100, target_score: 0, workspace_id: differentId,
    }, headers: { authorization: 'Bearer client-injected-key', 'x-workspace-id': differentId } });
    expect(response.status).toBe(200);
    const [destination, init] = upstream.mock.calls[0];
    expect(String(destination)).toBe('https://accord.example/v1/auctions');
    expect(init?.headers).toEqual({ Authorization: `Bearer ${secret}`, 'X-Workspace-ID': workspaceId, 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({
      scenario: 'dating', publisher_id: 'wavelength', intent: 'A quiet cafe', preferences: ['quiet'],
      mode: 'live', payment_mode: 'simulation', max_rounds: 5, target_score: 85,
    });
    expect(await response.text()).not.toContain(secret);
  });
  it('uses the Cloudflare service binding when present instead of cross-worker global fetch', async () => {
    const binding = { fetch: vi.fn().mockResolvedValue(Response.json(fixture())) };
    const { fetch, upstream } = setup(fixture(), 200, { EXCHANGE: binding });
    const response = await fetch('/api/auctions', { method: 'POST', data: { intent: 'A quiet cafe' } });
    expect(response.status).toBe(200);
    expect(upstream).not.toHaveBeenCalled();
    expect(binding.fetch).toHaveBeenCalledTimes(1);
    expect(binding.fetch.mock.contexts[0]).toBe(binding);
    const [destination, init] = binding.fetch.mock.calls[0];
    expect(String(destination)).toBe('https://accord.example/v1/auctions');
    expect(init.headers).toEqual({ Authorization: `Bearer ${secret}`, 'X-Workspace-ID': workspaceId, 'Content-Type': 'application/json' });
    expect(init.method).toBe('POST');
    expect(await response.text()).not.toContain(secret);
  });
  it.each(['POST', 'PATCH', 'DELETE'])('rejects a foreign-origin %s before any exchange call', async method => {
    const { fetch, upstream } = setup();
    const response = await fetch('/api/auctions', { method, data: {}, headers: { origin: 'https://foreign.example' } });
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('accepts a same-origin start and rejects cross-site browser mutations without Origin', async () => {
    const { fetch, upstream } = setup();
    expect((await fetch('/api/auctions', { method: 'POST', data: {}, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
    expect((await fetch('/api/auctions', { method: 'POST', data: {}, headers: { origin: 'https://wavelength.example' } })).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('returns only consumer-facing auction fields, excluding campaigns and offer boards', async () => {
    const { fetch } = setup();
    const response = await fetch(`/api/auctions/${auctionId}`);
    const body = await response.json() as Record<string,unknown>;
    expect(body).toMatchObject({ id: auctionId, scenario: 'dating', winner: fixture().winner, placement: fixture().placement });
    for (const key of ['bidders', 'rounds', 'events', 'trace', 'private_state']) expect(body).not.toHaveProperty(key);
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_|PUBLIC_BOARD_NOT_FOR_CONSUMER|INTERNAL_EVENT/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it.each(['GET', 'POST'])('hides another consumer scenario from %s auction/placement access', async method => {
    const { fetch, upstream } = setup(fixture({ scenario: 'fashion', publisher_id: 'wardrobe' }));
    const path = method === 'GET' ? `/api/auctions/${auctionId}` : `/api/placements/${placementId}/click`;
    const response = await fetch(path, { method, ...(method === 'POST' ? { data: { auction_id: auctionId } } : {}) });
    expect(response.status).toBe(404);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0][1]?.method).toBe('GET');
  });
  it('rejects a placement that does not match the owned auction without sending a click', async () => {
    const { fetch, upstream } = setup();
    expect((await fetch(`/api/placements/${differentId}/click`, { method: 'POST', data: { auction_id: auctionId } })).status).toBe(404);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0][1]?.method).toBe('GET');
  });
  it('checks ownership before forwarding the matched placement click', async () => {
    const { fetch, upstream } = setup();
    upstream.mockResolvedValueOnce(Response.json(fixture())).mockResolvedValueOnce(Response.json({ destination: 'https://sightglasscoffee.com', ledger: { amount_cents: 99 } }));
    expect((await fetch(`/api/placements/${placementId}/click`, { method: 'POST', data: { auction_id: auctionId } })).status).toBe(200);
    expect(upstream.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      [`https://accord.example/v1/auctions/${auctionId}`, 'GET'], [`https://accord.example/v1/placements/${placementId}/click`, 'POST'],
    ]);
  });
  it.each([{}, { auction_id: 'invalid' }, { auction_id: 4 }])('rejects malformed click attribution %#', async data => {
    const { fetch, upstream } = setup();
    expect((await fetch(`/api/placements/${placementId}/click`, { method: 'POST', data })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each(['{', '[]', 'null', JSON.stringify({ intent: 'x'.repeat(12001) })])('rejects malformed or oversized consumer payloads %#', async raw => {
    const { fetch, upstream } = setup();
    expect((await fetch('/api/auctions', { method: 'POST', raw })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('does not expose a publisher key from the public context endpoint', async () => {
    const { fetch, upstream } = setup();
    const response = await fetch('/api/context');
    const text = await response.text();
    expect(text).not.toContain(secret);
    expect(text).not.toContain('EXCHANGE_API_KEY');
    expect(JSON.parse(text)).toMatchObject({ agent_mode: 'live', payment_mode: 'simulation', scenario: { id: 'dating', publisher_id: 'wavelength' } });
    expect(upstream).not.toHaveBeenCalled();
  });
  it('fails visibly when the server publisher connection is missing', async () => {
    const { fetch, upstream } = setup(fixture(), 200, { EXCHANGE_API_KEY: '' });
    const response = await fetch('/api/auctions', { method: 'POST', data: {} });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Publisher connection is not configured' });
    expect(upstream).not.toHaveBeenCalled();
  });
});
