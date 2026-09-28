import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/workspace', () => ({ ExchangeWorkspace: class {} }));
vi.mock('../src/server/payments', () => ({ createFundingCheckout: vi.fn(), parseFundingWebhook: vi.fn() }));
import worker from '../src/server/index';
import { createFundingCheckout, parseFundingWebhook } from '../src/server/payments';

const workspaceId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const otherId = '11111111-2222-3333-4444-555555555555';
function setup() {
  const workspace = {
    bootstrap: vi.fn().mockResolvedValue({ auctions: [], ledger: [], campaigns: [], capabilities: {}, brands: [], scenarios: [] }),
    listAuctions: vi.fn().mockResolvedValue([]), ledger: vi.fn().mockResolvedValue([]), readAuction: vi.fn().mockResolvedValue({ id: 'test' }),
    start: vi.fn().mockImplementation(async input => ({ id: 'created', ...input })), action: vi.fn().mockResolvedValue({}),
    click: vi.fn().mockResolvedValue({}), updateCampaign: vi.fn().mockResolvedValue({}),
    simulationFund: vi.fn().mockResolvedValue({}), fund: vi.fn().mockResolvedValue({ credited: true }),
  };
  const env = { ADMIN_TOKEN: 'admin-secret', OPERATOR_WORKSPACE_ID: workspaceId, DEMO_WORKSPACE_ID: workspaceId, PUBLISHER_API_KEYS: JSON.stringify({wavelength:'publisher-secret',wardrobe:'wardrobe-secret',cityguide:'cityguide-secret'}), PUBLISHER_API_KEY: 'legacy-secret', STRIPE_SECRET_KEY: 'stripe-secret',
    STRIPE_WEBHOOK_SECRET: 'signing-secret', ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('asset')) },
    EXCHANGE: { getByName: vi.fn().mockReturnValue(workspace) } };
  const fetch = (path: string, options: { method?: string; data?: unknown; raw?: string; headers?: Record<string,string>; host?: string } = {}) => {
    const { method = 'GET', data, raw, headers, host = 'https://accord.example' } = options;
    return worker.fetch(new Request(`${host}${path}`, { method, headers, ...(data !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(data) } : {}) }), env as unknown as Env);
  };
  return { env, workspace, fetch };
}
const valid = { scenario: 'dating', intent: 'Coffee date', mode: 'simulation', preferences: ['quiet'] };
const admin = { 'x-admin-token': 'admin-secret', 'x-workspace-id': workspaceId };
const publisher = { authorization: 'Bearer publisher-secret', 'x-workspace-id': workspaceId };

beforeEach(() => vi.clearAllMocks());
describe('exchange HTTP boundary', () => {
  it('serves assets outside the API without creating a workspace', async () => {
    const { env, fetch } = setup();
    expect(await (await fetch('/')).text()).toBe('asset');
    expect(env.EXCHANGE.getByName).not.toHaveBeenCalled();
  });
  it('rejects anonymous reads and ignores unsigned workspace cookies', async () => {
    const { env, fetch } = setup();
    const response = await fetch('/api/bootstrap', { headers: { 'x-workspace-id': workspaceId, cookie: `accord_workspace=${workspaceId}` } });
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(env.EXCHANGE.getByName).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('keeps the authenticated admin in the configured owner workspace despite unsigned overrides', async () => {
    const { env, fetch } = setup();
    const response = await fetch('/v1/ledger', { headers: { 'x-admin-token': 'admin-secret', cookie: `accord_workspace=${otherId}`, 'x-workspace-id':otherId } });
    expect(response.status).toBe(200);expect(response.headers.get('set-cookie')).toBeNull();
    expect(env.EXCHANGE.getByName).toHaveBeenLastCalledWith(workspaceId);
  });
  it('requires authentication before parsing a remote mutation', async () => {
    const { workspace, fetch } = setup();
    const result = await fetch('/api/demo/dating/auctions', { method: 'POST', raw: '{invalid' });
    expect(result.status).toBe(401);
    expect(workspace.start).not.toHaveBeenCalled();
  });
  it('rejects remote foreign-origin mutations even with a valid administrator token', async () => {
    const { workspace, fetch } = setup();
    const response = await fetch('/api/demo/dating/auctions', {
      method: 'POST', data: valid, headers: { ...admin, origin: 'https://foreign.example' },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Cross-origin mutation is not allowed' });
    expect(workspace.start).not.toHaveBeenCalled();
  });
  it('allows the local Vite origin to reach the local Worker across host aliases and ports', async () => {
    const { workspace, fetch } = setup();
    const response = await fetch('/api/demo/dating/auctions', {
      host: 'http://127.0.0.1:8787', method: 'POST', data: valid, headers: { origin: 'http://localhost:5173' },
    });
    expect(response.status).toBe(201);
    expect(workspace.start).toHaveBeenCalledTimes(1);
  });
  it('reports a rejected sandbox configuration without silently switching payment modes', async () => {
    const { workspace, fetch } = setup();
    workspace.start.mockRejectedValueOnce(new Error('Stripe sandbox requires live agents and configured Stripe credentials.'));
    const response = await fetch('/api/demo/dating/auctions', {
      method: 'POST', data: { ...valid, mode: 'live', payment_mode: 'sandbox' }, headers: admin,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Stripe sandbox requires live agents and configured Stripe credentials.' });
    expect(workspace.start).toHaveBeenCalledTimes(1);
    expect(workspace.start).toHaveBeenCalledWith(expect.objectContaining({ mode: 'live', payment_mode: 'sandbox' }));
  });
  it('preserves explicit simulated money independently from live GPT agents', async () => {
    const { workspace, fetch } = setup();
    const response = await fetch('/api/demo/dating/auctions', {
      method: 'POST', data: { ...valid, mode: 'live', payment_mode: 'simulation' }, headers: admin,
    });
    expect(response.status).toBe(201);
    expect(workspace.start).toHaveBeenCalledWith(expect.objectContaining({ mode: 'live', payment_mode: 'simulation' }));
  });
  it('accepts the admin for a demo adapter and binds the adapter scenario', async () => {
    const { workspace, fetch } = setup();
    const result = await fetch('/api/demo/dating/auctions', { method: 'POST', data: { ...valid, scenario: 'fashion' }, headers: admin });
    expect(result.status).toBe(201);
    expect(workspace.start).toHaveBeenCalledWith(expect.objectContaining({ scenario: 'dating', mode: 'simulation' }));
  });
  it('requires publisher authentication on the machine API even for an admin', async () => {
    const { workspace, fetch } = setup();
    expect((await fetch('/v1/auctions', { method: 'POST', data: valid, headers: admin })).status).toBe(401);
    expect(workspace.start).not.toHaveBeenCalled();
  });
  it('lets an authenticated publisher choose its persistent workspace', async () => {
    const { env, workspace, fetch } = setup();
    expect((await fetch('/v1/auctions', { method: 'POST', data: valid, headers: publisher })).status).toBe(201);
    expect(env.EXCHANGE.getByName).toHaveBeenCalledWith(workspaceId);
    expect(workspace.start).toHaveBeenCalledTimes(1);
  });
  it('rejects publisher attribution inconsistent with the scenario adapter', async () => {
    const { workspace, fetch } = setup();
    expect((await fetch('/v1/auctions', { method: 'POST', data: { ...valid, publisher_id: 'attacker' }, headers: publisher })).status).toBe(400);
    expect(workspace.start).not.toHaveBeenCalled();
  });
  it.each([
    null, [], 'string', { ...valid, intent: '' }, { ...valid, intent: 'a'.repeat(2001) },
    { ...valid, preferences: ['a'.repeat(501)] }, { ...valid, preferences: [12] },
    { ...valid, preferences: Array(21).fill('quiet') }, { ...valid, mode: 'silent-fallback' },
    { ...valid, payment_mode: 'real' }, { ...valid, max_rounds: 6 }, { ...valid, max_rounds: 1.5 },
    { ...valid, target_score: 101 }, { ...valid, scenario: 'unknown' },
  ])('rejects malformed or out-of-contract auction input %#', async data => {
    const { workspace, fetch } = setup();
    expect((await fetch('/v1/auctions', { method: 'POST', data, headers: publisher })).status).toBe(400);
    expect(workspace.start).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON and oversized bodies', async () => {
    const { workspace, fetch } = setup();
    for (const raw of ['{', JSON.stringify({ ...valid, extra: 'x'.repeat(20000) })]) {
      expect((await fetch('/v1/auctions', { method: 'POST', raw, headers: publisher })).status).toBe(400);
    }
    expect(workspace.start).not.toHaveBeenCalled();
  });
  it('reserves campaign policy changes for the administrator', async () => {
    const { workspace, fetch } = setup();
    expect((await fetch('/v1/campaigns/sightglass', { method: 'PATCH', data: { max_cpc_cents: 500 }, headers: publisher })).status).toBe(401);
    expect(workspace.updateCampaign).not.toHaveBeenCalled();
    expect((await fetch('/v1/campaigns/sightglass', { method: 'PATCH', data: { max_cpc_cents: 500 }, headers: admin })).status).toBe(200);
    expect(workspace.updateCampaign).toHaveBeenCalledWith('sightglass', { max_cpc_cents: 500 });
  });
  it('keeps mutation routes inaccessible via GET', async () => {
    const { workspace, fetch } = setup();
    expect((await fetch(`/v1/placements/${workspaceId}/click`, { headers: admin })).status).toBe(404);
    expect(workspace.click).not.toHaveBeenCalled();
  });
  it('creates checkout for the verified brand and browser workspace', async () => {
    vi.mocked(createFundingCheckout).mockResolvedValue({ url: 'https://checkout.stripe.com/test', sessionId: 'cs_test' });
    const { fetch } = setup();
    expect((await fetch('/v1/campaigns/sightglass/fund', { method: 'POST', data: { amount_cents: 5000 }, headers: admin })).status).toBe(200);
    expect(createFundingCheckout).toHaveBeenCalledWith('stripe-secret', { brandId: 'sightglass', amountCents: 5000, origin: 'https://accord.example', workspaceId });
  });
  it('verifies webhook signatures independently of browser/admin credentials and uses the signed workspace', async () => {
    const event = { eventId: 'evt', brandId: 'sightglass', workspaceId: otherId, amountCents: 5000, chargeId: 'ch', processingFeeCents: 175 };
    vi.mocked(parseFundingWebhook).mockResolvedValue(event);
    const { env, workspace, fetch } = setup();
    expect((await fetch('/v1/stripe/webhook', { method: 'POST', raw: 'raw-event', headers: { 'stripe-signature': 'signed', cookie: `accord_workspace=${workspaceId}` } })).status).toBe(200);
    expect(parseFundingWebhook).toHaveBeenCalledWith('stripe-secret', 'signing-secret', 'raw-event', 'signed');
    expect(env.EXCHANGE.getByName).toHaveBeenLastCalledWith(otherId);
    expect(workspace.fund).toHaveBeenCalledWith(event);
  });
  it('never credits rejected or unrelated Stripe events', async () => {
    const { workspace, fetch } = setup();
    vi.mocked(parseFundingWebhook).mockRejectedValueOnce(new Error('Invalid signature'));
    expect((await fetch('/v1/stripe/webhook', { method: 'POST', raw: '{}' })).status).toBe(400);
    vi.mocked(parseFundingWebhook).mockResolvedValueOnce(null);
    expect((await fetch('/v1/stripe/webhook', { method: 'POST', raw: '{}' })).status).toBe(200);
    expect(workspace.fund).not.toHaveBeenCalled();
  });
});
