import Stripe from 'stripe';

/** Never accept a production credential in this hackathon application. */
export function assertSandboxKey(secret: string): void {
  if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(secret ?? '')) {
    throw new Error('A Stripe sandbox secret or restricted key is required. Live keys are disabled.');
  }
}

function stripeClient(secret: string): Stripe {
  assertSandboxKey(secret);
  return new Stripe(secret, {
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 8_000,
    maxNetworkRetries: 0, // The durable settlement outbox owns retry timing.
  });
}

function amount(value: number, minimum = 1): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > 100_000) {
    throw new Error(`Amount must be integer USD cents between ${minimum} and 100000.`);
  }
}

export interface FundingInput {
  brandId: string;
  amountCents: number;
  origin: string;
  workspaceId: string;
}

export async function createFundingCheckout(secret: string, input: FundingInput): Promise<{ url: string; sessionId: string }> {
  const stripe = stripeClient(secret);
  amount(input.amountCents, 100);
  if (!input.brandId || !input.workspaceId) throw new Error('Brand and workspace are required.');
  const origin = new URL(input.origin);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) {
    throw new Error('Checkout return origin must use HTTPS, except localhost.');
  }
  const metadata = { brand_id: input.brandId, workspace_id: input.workspaceId };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    metadata,
    payment_intent_data: { metadata },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: input.amountCents,
        product_data: { name: `Accord sandbox advertising credit: ${input.brandId}` },
      },
    }],
    success_url: `${origin.origin}/?funding=success`,
    cancel_url: `${origin.origin}/?funding=cancelled`,
  });
  if (session.livemode || !session.url) throw new Error('Stripe did not create a sandbox Checkout URL.');
  return { url: session.url, sessionId: session.id };
}

export interface VerifiedFunding {
  eventId: string;
  brandId: string;
  workspaceId: string;
  amountCents: number;
  chargeId: string;
  processingFeeCents: number;
}

/** Caller deduplicates eventId AND chargeId before recording any funding. */
export async function parseFundingWebhook(
  secret: string,
  webhookSecret: string,
  rawBody: string,
  signature: string,
): Promise<VerifiedFunding | null> {
  const stripe = stripeClient(secret);
  if (!webhookSecret?.startsWith('whsec_') || !signature) throw new Error('Missing Stripe webhook verification credentials.');
  const event = await stripe.webhooks.constructEventAsync(
    rawBody, signature, webhookSecret, undefined, Stripe.createSubtleCryptoProvider(),
  );
  if (event.livemode) throw new Error('Live Stripe events are disabled.');
  let brandId: string | undefined;
  let workspaceId: string | undefined;
  let paymentIntentId: string | undefined;
  let expectedAmount: number | null;
  let expectedChargeId: string | undefined;
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.livemode) throw new Error('Live Stripe sessions are disabled.');
    if (session.mode !== 'payment' || session.payment_status !== 'paid') return null;
    if (session.currency !== 'usd') throw new Error('Only USD funding is supported.');
    brandId = session.metadata?.brand_id;
    workspaceId = session.metadata?.workspace_id;
    paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    expectedAmount = session.amount_total;
  } else if (event.type === 'charge.updated') {
    // Stripe emits this after attaching the asynchronously created balance
    // transaction. Only our tagged funding charges participate in this path.
    const charge = event.data.object as Stripe.Charge;
    brandId = charge.metadata?.brand_id;
    workspaceId = charge.metadata?.workspace_id;
    if (!brandId || !workspaceId) return null;
    if (charge.livemode || !charge.paid || !charge.captured || charge.refunded || charge.amount_refunded > 0 || charge.disputed || charge.currency !== 'usd') {
      throw new Error('Funding requires a captured, unrefunded sandbox charge.');
    }
    paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    expectedAmount = charge.amount;
    expectedChargeId = charge.id;
    if (charge.amount_captured !== expectedAmount) throw new Error('Funding amounts do not reconcile.');
  } else return null;
  if (!brandId || !workspaceId) throw new Error('Funding metadata is missing.');
  if (!paymentIntentId) throw new Error('Funding payment intent is missing.');
  // Checkout completion can precede availability of the charge's balance
  // transaction. Briefly reread that provider state; never invent its fee.
  const readDeadline = Date.now() + 6_000;
  let intent!: Stripe.PaymentIntent;
  for (let attempt = 0; attempt < 3; attempt++) {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId,
      { expand: ['latest_charge.balance_transaction'] },
      { timeout: Math.max(1, readDeadline - Date.now()) });
    const pendingCharge = intent.latest_charge;
    const unavailable = !pendingCharge || typeof pendingCharge === 'string' || !pendingCharge.balance_transaction || typeof pendingCharge.balance_transaction === 'string';
    const invalidCharge = pendingCharge && typeof pendingCharge !== 'string' && (pendingCharge.livemode || !pendingCharge.paid || !pendingCharge.captured || pendingCharge.refunded || pendingCharge.amount_refunded > 0 || pendingCharge.disputed || pendingCharge.currency !== 'usd');
    if (!unavailable || invalidCharge || intent.status !== 'succeeded' || intent.livemode || intent.currency !== 'usd' || intent.metadata.brand_id !== brandId || intent.metadata.workspace_id !== workspaceId || intent.amount_received !== expectedAmount) break;
    const delay = 350 * (attempt + 1);
    if (attempt === 2 || Date.now() + delay >= readDeadline) break;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  if (intent.livemode || intent.status !== 'succeeded' || intent.currency !== 'usd') {
    throw new Error('Funding payment has not succeeded in USD sandbox mode.');
  }
  if (intent.metadata.brand_id !== brandId || intent.metadata.workspace_id !== workspaceId) throw new Error('Funding metadata does not match the payment.');
  const charge = intent.latest_charge;
  if (!charge || typeof charge === 'string' || charge.livemode || !charge.paid || !charge.captured || charge.refunded || charge.amount_refunded > 0 || charge.disputed || charge.currency !== 'usd') {
    throw new Error('Funding requires a captured, unrefunded sandbox charge.');
  }
  if (expectedChargeId && charge.id !== expectedChargeId) throw new Error('Funding charge does not match the payment.');
  const received = intent.amount_received;
  amount(received, 100);
  if (received !== expectedAmount || charge.amount !== received || charge.amount_captured !== received) {
    throw new Error('Funding amounts do not reconcile.');
  }
  const balance = charge.balance_transaction;
  if (!balance || typeof balance === 'string' || balance.currency !== 'usd' || balance.amount !== received || !Number.isSafeInteger(balance.fee) || balance.fee < 0) {
    // Retry the webhook rather than silently declaring unknown fees to be zero.
    console.warn('[stripe-funding] balance_reconciliation_pending', { event_id: event.id, charge_id: charge.id });
    throw new Error('Funding balance transaction is not ready to reconcile.');
  }
  return { eventId: event.id, brandId, workspaceId, amountCents: received, chargeId: charge.id, processingFeeCents: balance.fee };
}

export interface PublisherTransferInput {
  amountCents: number;
  destinationAccount: string;
  sourceChargeId: string;
  idempotencyKey: string;
  auctionId: string;
}

export async function createPublisherTransfer(secret: string, input: PublisherTransferInput): Promise<{ id: string }> {
  const stripe = stripeClient(secret);
  amount(input.amountCents);
  if (!input.destinationAccount.startsWith('acct_') || !input.sourceChargeId.startsWith('ch_') || !input.idempotencyKey || !input.auctionId) {
    throw new Error('A connected account, source charge, auction and stable idempotency key are required.');
  }
  const transfer = await stripe.transfers.create({
    amount: input.amountCents,
    currency: 'usd',
    destination: input.destinationAccount,
    source_transaction: input.sourceChargeId,
    metadata: { auction_id: input.auctionId },
  }, { idempotencyKey: input.idempotencyKey });
  if (transfer.livemode) throw new Error('Live transfers are disabled.');
  return { id: transfer.id };
}
