# Presentation deployment regression

PASS — 2026-09-28T21:25:35.444Z

Read-only HTTP verification of four independently deployed Workers. No auctions, campaigns, clicks, Stripe objects, or secrets were changed by this check.

- Four separate deployment origins
- dating: server-owned publisher identity and shared exchange target
- dating: HTML, JavaScript, CSS, reduced-motion and focus styling served successfully
- fashion: server-owned publisher identity and shared exchange target
- fashion: HTML, JavaScript, CSS, reduced-motion and focus styling served successfully
- outings: server-owned publisher identity and shared exchange target
- outings: HTML, JavaScript, CSS, reduced-motion and focus styling served successfully
- Exchange bootstrap: nine brands, three scenarios, shared stage and read-only recorded replay
- exchange: HTML, JavaScript, CSS, reduced-motion and focus styling served successfully

## Scope

This verifies served asset responses, content types, API configuration and static motion/focus declarations. It does not execute JavaScript or establish visual correctness, keyboard focus behavior, or browser-console cleanliness. Browser review is separate. Live auction and accounting evidence is in FOUR-APP-VERIFICATION.md and STRIPE-VERIFICATION.md.

## Reproduce

Run `node scripts/verify-presentation.mjs` with Node 22 or newer. Full asset hashes and results are in `test-results/presentation-verification.json`.

## Final served asset versions

Exchange deployment supplied by deployment owner: `271ddf1e-95c0-43be-a38d-270168e41fe2`. Current HTTP asset paths and ETags below were observed directly. All three consumer servers now report **sandbox** accounting. No auction or click was initiated by this check.

| Worker | Accounting mode | Asset | ETag |
|---|---|---|---|
| dating | sandbox | `/assets/index-Q9F2LUKm.js` | `W/"2c1fdc6eca99c42e4f434829dc80e40a"` |
| dating | sandbox | `/assets/index-DiCZurwG.css` | `W/"62adc3e4f79478fa9d88d4fb5581b300"` |
| exchange | exchange | `/assets/index-BMI3Hy6P.js` | `W/"8c6d89e39ddb934f6c117fdadcb5d1b5"` |
| exchange | exchange | `/assets/index-BaqeZ51f.css` | `W/"ad57b7ce746cd9fcfde350a6fe7e0f94"` |
| fashion | sandbox | `/assets/index-Q9F2LUKm.js` | `W/"2c1fdc6eca99c42e4f434829dc80e40a"` |
| fashion | sandbox | `/assets/index-DiCZurwG.css` | `W/"62adc3e4f79478fa9d88d4fb5581b300"` |
| outings | sandbox | `/assets/index-Q9F2LUKm.js` | `W/"2c1fdc6eca99c42e4f434829dc80e40a"` |
| outings | sandbox | `/assets/index-DiCZurwG.css` | `W/"62adc3e4f79478fa9d88d4fb5581b300"` |
