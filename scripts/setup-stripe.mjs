import Stripe from 'stripe';
import { readFile } from 'node:fs/promises';

// No credentials are printed or written. Environment takes precedence over .dev.vars.
let secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  try {
    const vars = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
    const value = vars.match(/^\s*STRIPE_SECRET_KEY\s*=\s*(.*?)\s*$/m)?.[1];
    secret = value?.replace(/^(['"])(.*)\1$/, '$2');
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not read local Stripe configuration.');
  }
}
if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(secret ?? '')) {
  console.error('Set a Stripe sandbox STRIPE_SECRET_KEY in the environment or .dev.vars. Live keys are disabled.');
  process.exit(1);
}

const stripe = new Stripe(secret, { timeout: 8_000, maxNetworkRetries: 1 });
const accounts = {};
try {
  const existing = await stripe.accounts.list({ limit: 100 }).autoPagingToArray({ limit: 1000 });
  for (const publisher of ['wavelength', 'wardrobe', 'cityguide']) {
    let account = existing.find(item => item.metadata?.project === 'accord-agent-exchange' && item.metadata?.publisher_id === publisher);
    if (!account) {
      // New Connect platforms require Accounts v2 for Stripe-managed risk.
      // Full dashboard avoids the Express + Managed Risk preview requirement.
      const response = await fetch('https://api.stripe.com/v2/core/accounts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
          'Stripe-Version': '2026-08-26.dahlia',
          'Idempotency-Key': `accord-demo-publisher-${publisher}-accounts-v2`,
        },
        body: JSON.stringify({
          display_name: `Accord demo ${publisher}`,
          contact_email: `${publisher}@accord.example`,
          dashboard: 'full',
          identity: { country: 'us' },
          defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
          configuration: {
            merchant: { capabilities: { card_payments: { requested: true } } },
            recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
          },
          metadata: { project: 'accord-agent-exchange', publisher_id: publisher },
        }),
        signal: AbortSignal.timeout(8_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Stripe account creation failed.');
      account = await stripe.accounts.retrieve(result.id);
    }
    accounts[publisher] = account.id;
    console.log(`${publisher}: ${account.id}; transfers capability: ${account.capabilities?.transfers ?? 'not enabled'}`);
  }
  console.log(`STRIPE_PUBLISHERS=${JSON.stringify(accounts)}`);
  console.log('Complete sandbox onboarding in the Stripe Dashboard for inactive accounts. The script does not accept terms, add real identity data, or change platform loss liability. No bank payout has occurred.');
} catch (error) {
  console.error(`Stripe sandbox setup failed (${error.type ?? 'configuration error'}). Check Connect enablement, test account requirements, and key permissions.`);
  console.error(String(error.message ?? 'No additional Stripe details.').replace(/(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+/g, '[redacted]').replace(/whsec_[A-Za-z0-9]+/g, '[redacted]'));
  process.exitCode = 1;
}
