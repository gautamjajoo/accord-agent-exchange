# Stripe sandbox setup

Accord only accepts Stripe sandbox/test secret or restricted keys. Production keys are rejected. Auction selection reserves advertising funds; the first click charges the winning CPC and allocates 80% to the publisher. Discounts remain fictional codes and never move money.

## Configure the local environment

Enable Connect on your Stripe platform in a sandbox. Add these entries to the project's untracked `.dev.vars` file, retaining any existing settings:

```dotenv
STRIPE_SECRET_KEY=sk_test_REPLACE_LOCALLY
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_LOCALLY
STRIPE_PUBLISHERS={"wavelength":"acct_REPLACE","wardrobe":"acct_REPLACE","cityguide":"acct_REPLACE"}
```

Never paste real secrets into chat, commit `.dev.vars`, or use a live Stripe key. Stripe restricted test keys must permit Checkout, PaymentIntent reads, transfers, and connected-account creation if running the setup script.

From this project directory, create the publisher sandbox accounts:

```sh
node scripts/setup-stripe.mjs
```

The script takes no arguments. It reads `STRIPE_SECRET_KEY` from the environment, otherwise from `.dev.vars`. It reuses existing accounts tagged with this project/publisher metadata, creating missing US test accounts through Accounts v2. Accounts use the full Stripe Dashboard and Stripe as fees/losses collector; the script does not change platform loss liability. It requests merchant card payments and recipient transfers, then prints the `STRIPE_PUBLISHERS` mapping. Copy that mapping into `.dev.vars`. It prints account IDs and capability status, never the secret key.

Complete sandbox onboarding through the Stripe Dashboard if transfers are not active. Requested capability does not mean activated capability. Stripe-managed accounts require Stripe-hosted acceptance and bank details; the setup script does not accept agreements on their behalf. Use Stripe's sandbox test-data shortcuts and [documented synthetic verification values](https://docs.stripe.com/connect/testing), never real identity or bank information. The Dashboard's test connected-account blueprint can also create an already transfer-capable sample; tag that account's metadata with `project=accord-agent-exchange` and the corresponding `publisher_id` before rerunning setup.

Metadata lookup prevents normal repeated runs from creating duplicates. Stable create idempotency keys additionally protect interrupted immediate reruns. The script lists up to 1,000 connected accounts; large real-platform account management is outside this demo.

If an older Express request reports that the platform must acknowledge loss liability, use this Accounts v2 script instead of enabling platform liability solely to run the demo. The full Dashboard setup avoids the Express/Managed Risk preview combination. The existing demo's Wavelength account has an externally verified successful sandbox transfer; verify capability status separately for the other publishers after onboarding.

## Forward signed events locally

Install and authenticate the official Stripe CLI, selecting the same sandbox as the server key. In one terminal:

```sh
stripe listen --events checkout.session.completed,charge.updated --forward-to http://localhost:8787/v1/stripe/webhook
```

Copy the CLI's webhook signing secret into `.dev.vars` as `STRIPE_WEBHOOK_SECRET`. Restart the Worker after changing variables:

```sh
npm run build
npm run preview
```

Keep the Stripe listener running. The CLI signing secret and a deployed Dashboard endpoint's secret are different; use the one corresponding to the endpoint receiving events.

## Test the complete funding and click flow

1. Fund a campaign through the app. The allowed amount is $1–$1,000 USD.
2. In Stripe Checkout, use test card `4242 4242 4242 4242`, any future expiration, and any three-digit CVC.
3. Confirm the signed webhook was delivered. A success redirect alone does not credit the campaign.
4. Check the ledger: one funding entry, its source charge ID, and a separate processing-fee entry should appear.
5. Run a live auction using the funded campaign, then click the winning recommendation before its ten-minute reservation expires.
6. Confirm one CPC charge and the 80/20 split. A publisher transfer entry must show a real sandbox `tr_` ID to count as settled. A pending transfer retains its error and retries without charging again.
7. Click the same placement again. It must not create another charge or transfer. Replay the same webhook event; it must not create another funding credit.

Funding is reconciled against a succeeded sandbox PaymentIntent, captured paid USD charge, matching amounts and metadata, and the actual Stripe balance-transaction fee. If the balance transaction is temporarily unavailable, webhook processing fails for retry instead of inventing a zero fee.

When one click spans multiple funding charges, the publisher share is split into source-linked transfers. Cumulative integer rounding preserves the exact 80% total while keeping each transfer within its source-charge portion. Each transfer has a stable idempotency key. A transfer to a connected Stripe account is not a completed bank payout.

## Deploy

Store secrets through Wrangler's interactive prompts; do not put values in shell history:

```sh
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_PUBLISHERS
```

Register the deployed `https://YOUR-WORKER/v1/stripe/webhook` endpoint in Stripe's sandbox Workbench. Subscribe to `checkout.session.completed` and `charge.updated`, then store that endpoint's signing secret:

```sh
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npm run deploy
```

If `STRIPE_PUBLISHERS` is already declared as a non-secret Wrangler variable, replace its empty mapping with the printed account IDs in that configuration instead of creating a secret with the same name. Account IDs are not credentials.

## Troubleshooting and limits

- **No credit after Checkout:** inspect webhook delivery, signature secret, metadata, and captured charge status. Retrying a verified event is safe.
- **Transfer pending:** confirm the publisher mapping, the destination's active transfers capability, platform Connect setup, and test key permissions.
- **Missing model key:** simulation uses a separate simulated balance and never produces real Stripe transfers. Add the model credential for live-agent auctions.
- **Outbox retry interrupted beyond 24 hours:** inspect Stripe transfers before resuming, since Stripe may have expired an idempotency key. This demo does not provide long-term production reconciliation.
- Refunds, disputes after funding, tax, coupon redemption, and production fraud handling are outside this sandbox demo. Do not deploy it for real money.

Run the payment tests with `npm test -- tests/payments.test.ts`. They mock outbound Stripe calls and also verify genuine Stripe webhook signatures against untampered and tampered payloads. Passing these tests does not establish that your sandbox account or Connect onboarding is configured.

### Automatic funding reconciliation

Checkout completion may arrive before Stripe creates the charge’s balance transaction. The handler briefly rereads provider state; if the fee is still unavailable, it keeps funding pending rather than inventing a zero fee. Stripe’s later signed `charge.updated` event reconciles our tagged funding charge against its succeeded PaymentIntent, captured USD amount, matching metadata, and actual fee. Both event and charge IDs are deduplicated, so Checkout retries and charge updates credit only once. Untagged charge updates are ignored.

This automatic path was verified with a fresh $1 hosted Checkout on 2026-09-28: the later charge update credited 100 cents and recorded the actual 33-cent processing fee without a manual resend. See [verified transaction evidence](docs/STRIPE-VERIFICATION.md).
