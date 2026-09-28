# Verified sandbox transactions

Verified against the deployed Worker on 2026-09-28. All amounts below are Stripe test-mode funds, not real money.

## Full dating-consumer flow with three funded brands

Verified at 21:01 UTC through the deployed dating consumer, not by directly creating a test auction in the exchange console.

- Consumer: `https://accord-dating-demo.kairosity-main-website.workers.dev`
- Shared presentation stage: `ef5d07d4-fc2a-41d9-b0bc-e1869dfb8e7c`
- Dating deployment: `dd92db68-7a40-45e7-9c1c-848b30a81e0a`, `DEMO_PAYMENT_MODE=sandbox`
- All three café campaigns received separate $100 Stripe-hosted Checkout funding credits in the shared stage. Each payment was reconciled from a signed Stripe event and captured charge.
- Live GPT auction: `2d9975c9-16d0-4e0b-b428-40744f47c5cc`, five completed rounds.
- **Ritual won with a 90-cent advertising bid and $4.50 discount. Blue Bottle offered a higher 180-cent bid but lost on user value.**
- Ritual's simulated two-coffee basket became $11.50 after discount. Code: `RITUAL-DEMO`; no real merchant coupon was issued.
- Winner changed across rounds: Sightglass → Blue Bottle → Ritual → Sightglass → Ritual.
- Click: `click:ffe20b6e-49a0-4f40-a589-6bf7021c3568`, exactly one 90-cent debit, 72-cent publisher share, and 18-cent network gross.
- Stripe transfer: `tr_3UKlbYAXV45EOxtS2U9yb5LB`, retrieved independently from Stripe and verified as `livemode: false`, amount 72 cents, destination `acct_1UKl98AXV4m5HQya`, source `ch_3UKlbYAXV45EOxtS2M6HCX91`.
- Repeating the consumer click returned the same ledger ID. The ledger contained one click and one transfer for this auction.
- Detailed evidence: `test-results/dating-consumer-sandbox.json` and `test-results/dating-sandbox-funding.json` (ignored runtime artifacts).

The Blue Bottle and Ritual funding events initially remained pending delivery. Both were resent through the official Stripe CLI to the registered endpoint, then credited once. No locally fabricated webhook or manual ledger credit was used. Later live webhook traces established the same failure condition on outing funding: Checkout completion preceded the charge balance transaction, so its processing fee was unavailable. The automatic reconciliation fix and fresh-payment verification are documented below.

New browser workspaces still start at zero sandbox balance. This funded demonstration is attached to the explicit shared presentation stage; other workspaces must complete their own Checkout funding.

## Full fashion-consumer flow

Verified at 21:14 UTC through `https://accord-shopping-demo.kairosity-main-website.workers.dev`, using the same shared presentation stage. Allbirds, Rothy’s, and Everlane each received a verified $100 sandbox funding credit.

- Fashion deployment: `58d42f7e-8ac4-4e62-b50c-91e3885f7ebd`, `DEMO_PAYMENT_MODE=sandbox`.
- Live GPT auction: `75554173-f2e3-4247-aa7c-5e1e12c133b4`, five rounds.
- Request emphasized everyday walking, machine washing, recycled materials, and a polished low-profile style.
- Rothy’s won with an 80-cent advertising bid and $45 discount on its $145 catalog snapshot, making the effective price $100 before tax and shipping.
- Click: `click:594d09be-6fc3-419a-bb9b-05f85cc23974`, one 80-cent charge, 64-cent publisher share, 16-cent network gross.
- Stripe transfer: `tr_3UKlj9AXV45EOxtS0S5H9gQT`, independently retrieved and verified as 64 cents, `livemode: false`, destination `acct_1UKlBDAXV4J8uehM`, source `ch_3UKlj9AXV45EOxtS0NuL6lBn`.
- Two concurrent click requests returned the same ledger ID; only one click charge and transfer were recorded.
- Detailed evidence: `test-results/fashion-consumer-sandbox.json`.

An earlier legitimate request selected Allbirds with a one-cent CPC. Its 80% publisher share rounds down to zero cents, so no publisher transfer was required; the one-cent network amount was recorded once. Auction `75d6667b-4680-4c01-bbc7-c6a765ad52a7` is preserved in `test-results/fashion-penny-bid-sandbox.json`. No campaign policy or auction rule was changed to force a higher bid. This is an economic limitation of ranking cash only as a score tie-breaker, and an accounting edge case the demo handles explicitly.

## Earlier settlement and retry verification

1. The deployed funding endpoint created a $100 Sightglass advertising Checkout session.
2. Stripe-hosted Checkout accepted the official `4242` test card and reported a paid session and succeeded PaymentIntent.
3. Stripe delivered `checkout.session.completed` to the deployed signed webhook. The exchange credited 10,000 cents once and recorded the actual 320-cent processing fee separately.
4. A real GPT café auction completed three rounds and reserved Sightglass’s 75-cent CPC.
5. Three concurrent click requests returned the same ledger ID: one 75-cent charge, 60 cents publisher earnings, and 15 cents network gross.
6. The durable transfer job initially remained pending while the publisher mapping was unavailable. After configuration, its automatic retry completed without another click charge.
7. The exchange’s completed transfer corresponds to Stripe test transfer `tr_3UKl7JAXV45EOxtS1FdmWBGS` for 60 cents. This is a connected-account transfer, not a bank payout.

### Evidence

- Funding event: `evt_1UKl7KAXV45EOxtSsk66v9KN`
- Source charge: `ch_3UKl7JAXV45EOxtS14j2aT1H`
- Auction: `7fd427da-3039-44e3-93ee-cffd2dc8ffc2`
- Click: `click:4f618e7a-8667-4065-a386-4346895184d2`
- Local detailed results: `test-results/stripe-funding-click.json` and `test-results/stripe-ledger.json` (ignored runtime artifacts)

This earlier run funded Sightglass only and tested settlement retry. The later consumer run above verifies three funded brands competing and a lower-cash-bid winner with an actual sandbox publisher transfer.

## Full outings-consumer flow

Verified at 21:25 UTC through `https://accord-outings-demo.kairosity-main-website.workers.dev` in the shared presentation stage. Exploratorium, California Academy of Sciences, and SFMOMA each received a verified $100 sandbox credit. All three publishers’ Stripe accounts reported an active transfers capability.

- Outings deployment: `91786a52-327f-4070-a71e-11600e0dda1f`, `DEMO_PAYMENT_MODE=sandbox`.
- Live GPT auction: `c4c769d5-b66e-4604-968f-8c7ca2684a0c`.
- Request: a social evening for two adults with hands-on science and interactive exhibits.
- Exploratorium won with an 85-cent advertising bid and $9 discount on the $60 two-person demo quote, making the effective quote $51.
- Click: `click:ec46ff0b-f149-4743-907e-c6f2b21a4d55`, exactly one 85-cent charge, 68-cent publisher share, and 17-cent network gross.
- Stripe transfer: `tr_3UKlufAXV45EOxtS1LnVckzr`, independently retrieved as 68 cents, sandbox, destination `acct_1UKlBIAXV4bIdZWJ`, source `ch_3UKlufAXV45EOxtS1lUsBMo3`.
- Two concurrent click requests returned the same ledger ID and produced one transfer.
- Evidence: `test-results/outings-consumer-sandbox.json`, `test-results/outings-sandbox-funding.json`, and `test-results/publisher-capabilities.json`.

## Automatic funding after asynchronous fee availability

Live Worker traces for the Exploratorium and California Academy Checkout events showed HTTP 400 with `balance_reconciliation_pending`. Stripe subsequently emitted `charge.updated` with a newly attached balance transaction. This establishes the initial delay’s cause: a succeeded Checkout can arrive before its actual processing-fee record is available.

Main deployment `271ddf1e-95c0-43be-a38d-270168e41fe2` accepts signed `checkout.session.completed` and `charge.updated` events. It independently retrieves the PaymentIntent and validates succeeded sandbox USD payment, matching metadata, exact captured amount, the same charge, and actual processing fee. Untagged charge updates are ignored. Charge-level deduplication prevents either event path from crediting twice.

The three already-paid outing events were resent using the official Stripe CLI after deployment. A separate **fresh $1 SFMOMA hosted Checkout then credited automatically, without any resend**:

- Charge update: `evt_3UKm2LAXV45EOxtS2LLXQvED`, zero pending webhook deliveries when checked.
- Source charge: `ch_3UKm2LAXV45EOxtS2UTe07i2`.
- One 100-cent funding credit and separate actual 33-cent processing fee.
- Evidence: `test-results/automatic-funding.json`; observed earlier failure traces: `test-results/webhook-observed-statuses.json`.

Payment and accounting tests cover signed events for both paths, invalid/foreign charge metadata, mismatched latest charges, unavailable fees, cross-event charge deduplication, source-linked transfer retries, and concurrent clicks. No webhook was locally forged for deployed verification and no ledger balance was manually credited.
