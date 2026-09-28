import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { assertSandboxKey, createFundingCheckout, createPublisherTransfer, parseFundingWebhook } from '../src/server/payments';

const sdk = vi.hoisted(() => ({
  checkout: vi.fn(), webhook: vi.fn(), retrieve: vi.fn(), transfer: vi.fn(), config: vi.fn(), crypto: {},
}));
vi.mock('stripe', () => ({ default: class {
  constructor(key: string, options: unknown) { sdk.config(key, options); }
  static createFetchHttpClient() { return 'fetch-client'; }
  static createSubtleCryptoProvider() { return sdk.crypto; }
  checkout = { sessions: { create: sdk.checkout } };
  webhooks = { constructEventAsync: sdk.webhook };
  paymentIntents = { retrieve: sdk.retrieve };
  transfers = { create: sdk.transfer };
} }));

const key = 'sk_test_example';
const funding = { brandId: 'sightglass', amountCents: 5000, origin: 'http://localhost:8787', workspaceId: 'demo' };
const transfer = { amountCents: 96, destinationAccount: 'acct_test', sourceChargeId: 'ch_test', idempotencyKey: 'auction1-click1', auctionId: 'auction1' };

function event() {
  return {
    id: 'evt_test', type: 'checkout.session.completed', livemode: false,
    data: { object: { id: 'cs_test', mode: 'payment', payment_status: 'paid', livemode: false, currency: 'usd', amount_total: 5000,
      metadata: { brand_id: 'sightglass', workspace_id: 'demo' }, payment_intent: 'pi_test' } },
  };
}
function payment() {
  return {
    id: 'pi_test', status: 'succeeded', currency: 'usd', livemode: false, amount_received: 5000,
    metadata: { brand_id: 'sightglass', workspace_id: 'demo' },
    latest_charge: { id: 'ch_test', currency: 'usd', livemode: false, paid: true, captured: true, refunded: false, amount_refunded: 0,
      disputed: false, amount: 5000, amount_captured: 5000, balance_transaction: { amount: 5000, currency: 'usd', fee: 175 } },
  };
}
function chargeEvent() {
  const intent = payment();
  return { id: 'evt_charge', type: 'charge.updated', livemode: false,
    data: { object: { ...intent.latest_charge, metadata: intent.metadata, payment_intent: intent.id } } };
}
beforeEach(() => {
  vi.resetAllMocks();
  sdk.checkout.mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/test', livemode: false });
  sdk.webhook.mockResolvedValue(event());
  sdk.retrieve.mockResolvedValue(payment());
  sdk.transfer.mockResolvedValue({ id: 'tr_test', livemode: false });
});

describe('sandbox payment boundary', () => {
  it.each(['sk_live_example', 'rk_live_example', '', 'pk_test_example', 'sk_test_example\n'])('rejects unsafe credential %j before network access', async secret => {
    expect(() => assertSandboxKey(secret)).toThrow();
    await expect(createFundingCheckout(secret, funding)).rejects.toThrow();
    await expect(createPublisherTransfer(secret, transfer)).rejects.toThrow();
    expect(sdk.checkout).not.toHaveBeenCalled();
    expect(sdk.transfer).not.toHaveBeenCalled();
  });
  it('accepts restricted sandbox keys', () => expect(() => assertSandboxKey('rk_test_example')).not.toThrow());
  it.each([0, 99, 100.5, 100001, NaN])('rejects invalid funding amount %j', async amountCents => {
    await expect(createFundingCheckout(key, { ...funding, amountCents })).rejects.toThrow();
    expect(sdk.checkout).not.toHaveBeenCalled();
  });
  it('creates card-only USD checkout with matching session and intent metadata', async () => {
    await expect(createFundingCheckout(key, funding)).resolves.toEqual({ sessionId: 'cs_test', url: 'https://checkout.stripe.com/test' });
    expect(sdk.checkout).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment', payment_method_types: ['card'], metadata: { brand_id: 'sightglass', workspace_id: 'demo' },
      payment_intent_data: { metadata: { brand_id: 'sightglass', workspace_id: 'demo' } },
      success_url: 'http://localhost:8787/?funding=success', cancel_url: 'http://localhost:8787/?funding=cancelled',
    }));
    expect(sdk.config).toHaveBeenCalledWith(key, expect.objectContaining({ timeout: 8000, maxNetworkRetries: 0 }));
  });
  it('rejects unsafe return URL', async () => {
    await expect(createFundingCheckout(key, { ...funding, origin: 'http://public.example' })).rejects.toThrow();
  });
});

describe('funding reconciliation', () => {
  it('verifies raw bytes asynchronously and reconciles actual charge and fee', async () => {
    await expect(parseFundingWebhook(key, 'whsec_test', ' raw body ', 'signature')).resolves.toEqual({
      eventId: 'evt_test', brandId: 'sightglass', workspaceId: 'demo', amountCents: 5000, chargeId: 'ch_test', processingFeeCents: 175,
    });
    expect(sdk.webhook).toHaveBeenCalledWith(' raw body ', 'signature', 'whsec_test', undefined, sdk.crypto);
    expect(sdk.retrieve).toHaveBeenCalledWith('pi_test', { expand: ['latest_charge.balance_transaction'] }, { timeout: expect.any(Number) });
  });
  it('does not retrieve or credit unpaid sessions', async () => {
    const data = event(); data.data.object.payment_status = 'unpaid'; sdk.webhook.mockResolvedValue(data);
    await expect(parseFundingWebhook(key, 'whsec_test', '{}', 'sig')).resolves.toBeNull();
    expect(sdk.retrieve).not.toHaveBeenCalled();
  });
  it('ignores unrelated signed events', async () => {
    sdk.webhook.mockResolvedValue({ ...event(), type: 'payment_intent.created' });
    await expect(parseFundingWebhook(key, 'whsec_test', '{}', 'sig')).resolves.toBeNull();
  });
  it.each(['livemode', 'currency', 'amount_total'])('rejects inconsistent session %s', async field => {
    const data = event(); Object.assign(data.data.object, { [field]: field === 'livemode' ? true : field === 'currency' ? 'eur' : 4000 });
    sdk.webhook.mockResolvedValue(data);
    await expect(parseFundingWebhook(key, 'whsec_test', '{}', 'sig')).rejects.toThrow();
  });
  it.each(['captured', 'refunded', 'disputed', 'amount_refunded'])('rejects invalid charge %s', async field => {
    const data = payment(); Object.assign(data.latest_charge, { [field]: field === 'captured' ? false : field === 'amount_refunded' ? 1 : true });
    sdk.retrieve.mockResolvedValue(data);
    await expect(parseFundingWebhook(key, 'whsec_test', '{}', 'sig')).rejects.toThrow();
  });
  it('does not treat an unavailable processing fee as zero', async () => {
    const data = payment(); Object.assign(data.latest_charge, { balance_transaction: null }); sdk.retrieve.mockResolvedValue(data);
    await expect(parseFundingWebhook(key, 'whsec_test', '{}', 'sig')).rejects.toThrow('not ready');
    expect(sdk.retrieve).toHaveBeenCalledTimes(3);
  });
  it('briefly rereads a not-yet-available balance transaction and uses its actual fee', async () => {
    const pending = payment(); Object.assign(pending.latest_charge, { balance_transaction: null });
    sdk.retrieve.mockResolvedValueOnce(pending).mockResolvedValueOnce(payment());
    await expect(parseFundingWebhook(key, 'whsec_test', '{}', 'sig')).resolves.toHaveProperty('processingFeeCents', 175);
    expect(sdk.retrieve).toHaveBeenCalledTimes(2);
  });
  it('does not retry invalid currency as if it were a transient fee delay', async () => {
    const pending = payment(); pending.currency = 'eur'; Object.assign(pending.latest_charge, { balance_transaction: null });
    sdk.retrieve.mockResolvedValue(pending);
    await expect(parseFundingWebhook(key, 'whsec_test', '{}', 'sig')).rejects.toThrow('USD');
    expect(sdk.retrieve).toHaveBeenCalledTimes(1);
  });
  it('rejects metadata mismatch', async () => {
    const data = payment(); data.metadata.brand_id = 'other'; sdk.retrieve.mockResolvedValue(data);
    await expect(parseFundingWebhook(key, 'whsec_test', '{}', 'sig')).rejects.toThrow('does not match');
  });
  it('reconciles a tagged charge update using the actual succeeded intent and fee', async () => {
    sdk.webhook.mockResolvedValue(chargeEvent());
    await expect(parseFundingWebhook(key, 'whsec_test', '{}', 'sig')).resolves.toEqual({
      eventId: 'evt_charge', brandId: 'sightglass', workspaceId: 'demo', amountCents: 5000, chargeId: 'ch_test', processingFeeCents: 175,
    });
  });
  it('ignores unrelated charge updates before retrieving a payment', async () => {
    const data = chargeEvent(); Object.assign(data.data.object, { metadata: {} }); sdk.webhook.mockResolvedValue(data);
    await expect(parseFundingWebhook(key, 'whsec_test', '{}', 'sig')).resolves.toBeNull();
    expect(sdk.retrieve).not.toHaveBeenCalled();
  });
  it.each(['captured', 'paid', 'refunded', 'currency', 'amount_captured'])('rejects invalid signed charge update %s', async field => {
    const data = chargeEvent(); Object.assign(data.data.object, { [field]: ['captured', 'paid'].includes(field) ? false : field === 'currency' ? 'eur' : field === 'amount_captured' ? 4999 : true });
    sdk.webhook.mockResolvedValue(data);
    await expect(parseFundingWebhook(key, 'whsec_test', '{}', 'sig')).rejects.toThrow();
    expect(sdk.retrieve).not.toHaveBeenCalled();
  });
  it('rejects a charge update for a different latest payment charge', async () => {
    const data = chargeEvent(); data.data.object.id = 'ch_other'; sdk.webhook.mockResolvedValue(data);
    await expect(parseFundingWebhook(key, 'whsec_test', '{}', 'sig')).rejects.toThrow('charge does not match');
  });
  it('rejects charge update metadata that does not match its succeeded intent', async () => {
    const data = chargeEvent(); data.data.object.metadata.brand_id = 'other'; sdk.webhook.mockResolvedValue(data);
    await expect(parseFundingWebhook(key, 'whsec_test', '{}', 'sig')).rejects.toThrow('metadata does not match');
  });
  it.each(['checkout', 'charge'])('verifies actual Stripe signatures and rejects body tampering for %s', async kind => {
    const { default: ActualStripe } = await vi.importActual<typeof import('stripe')>('stripe');
    const actual = new ActualStripe(key);
    sdk.webhook.mockImplementation((body, signature, secret) => actual.webhooks.constructEventAsync(body, signature, secret, undefined, ActualStripe.createSubtleCryptoProvider()));
    const raw = JSON.stringify(kind === 'charge' ? chargeEvent() : event());
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = createHmac('sha256', 'whsec_test').update(`${timestamp}.${raw}`).digest('hex');
    const signature = `t=${timestamp},v1=${digest}`;
    await expect(parseFundingWebhook(key, 'whsec_test', raw, signature)).resolves.toHaveProperty('amountCents', 5000);
    sdk.retrieve.mockClear();
    await expect(parseFundingWebhook(key, 'whsec_test', `${raw} `, signature)).rejects.toThrow();
    expect(sdk.retrieve).not.toHaveBeenCalled();
  });
});

describe('publisher settlement', () => {
  it('ties transfers to a source charge and retains the same retry key', async () => {
    await createPublisherTransfer(key, transfer);
    await createPublisherTransfer(key, transfer);
    for (const [body, options] of sdk.transfer.mock.calls) {
      expect(body).toEqual({ amount: 96, currency: 'usd', destination: 'acct_test', source_transaction: 'ch_test', metadata: { auction_id: 'auction1' } });
      expect(options).toEqual({ idempotencyKey: 'auction1-click1' });
    }
  });
  it('propagates failure to the durable outbox for retry', async () => {
    sdk.transfer.mockRejectedValue(new Error('Stripe unavailable'));
    await expect(createPublisherTransfer(key, transfer)).rejects.toThrow('Stripe unavailable');
  });
  it('requires a source charge and stable key', async () => {
    await expect(createPublisherTransfer(key, { ...transfer, sourceChargeId: '' })).rejects.toThrow();
    await expect(createPublisherTransfer(key, { ...transfer, idempotencyKey: '' })).rejects.toThrow();
    expect(sdk.transfer).not.toHaveBeenCalled();
  });
});
