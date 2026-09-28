# Four-server integration verification

PASS — 2026-09-28T20:53:31.471Z

This checks real HTTP calls through three independently deployed consumer Workers into the separate Accord exchange. All agent decisions use gpt-5.4-mini. Payment mode is reported explicitly; simulated receipts do not establish Stripe transfer completion.

Exchange: https://accord-agent-exchange.kairosity-main-website.workers.dev

Shared presentation workspace: `ef5d07d4-fc2a-41d9-b0bc-e1869dfb8e7c`

| Consumer | Publisher | Exact auction ID on both servers | Winner | Rounds | CPC | Publisher credit | Money mode |
|---|---|---|---|---:|---:|---:|---|
| dating | wavelength | 157bc688-b056-490a-adea-3f1caa6ed29f | Ritual | 4 | $1.45 | $1.16 | simulation |
| fashion | wardrobe | 715ec8e8-9478-49b0-80fa-2dcd7c3386d9 | Allbirds | 4 | $1.20 | $0.96 | simulation |
| outings | cityguide | ff7de411-779b-41db-b1a2-74e0ee5e0312 | Exploratorium | 5 | $0.40 | $0.32 | simulation |

## Checks

- exchange shared presentation stage and live model available
- dating: separate publisher server fixes identity and requests live GPT
- dating: identical auction ID visible in exchange shared stage
- dating: exact exchange winner and discount code returned to consumer
- dating: another publisher cannot read or charge its placement
- dating: three simultaneous consumer clicks make one attributed 80/20 exchange charge
- fashion: separate publisher server fixes identity and requests live GPT
- fashion: identical auction ID visible in exchange shared stage
- fashion: exact exchange winner and discount code returned to consumer
- fashion: another publisher cannot read or charge its placement
- fashion: three simultaneous consumer clicks make one attributed 80/20 exchange charge
- outings: separate publisher server fixes identity and requests live GPT
- outings: identical auction ID visible in exchange shared stage
- outings: exact exchange winner and discount code returned to consumer
- outings: another publisher cannot read or charge its placement
- outings: three simultaneous consumer clicks make one attributed 80/20 exchange charge
- consumer API payloads contain no model keys or private campaigns

## Reproduce

Run with Node 22 or newer after deployment and secret setup:

```sh
node scripts/verify-four-apps.mjs
```

Override origins with EXCHANGE_URL, DATING_URL, SHOPPING_URL, OUTINGS_URL if needed. Machine-readable evidence: `test-results/four-app-verification.json`. This verifier makes live GPT requests and three idempotent click requests per winning placement.
