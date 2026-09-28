# Deployed verification

Verified against https://accord-agent-exchange.kairosity-main-website.workers.dev on 2026-09-28. All mutations below use explicitly simulated agents and simulated money. No card or real funds used.

- PASS — HTTP document: `{"status": 200}`
- PASS — Built asset /assets/index-CJl8Kbal.js: `{"status": 200, "length": 261260}`
- PASS — Built asset /assets/index-KnnQOyTw.css: `{"status": 200, "length": 34561}`
- PASS — Bootstrap: `{"live_agents": true, "stripe": false, "model": "gpt-5.4-mini", "demo_only": true}`
- PASS — Unauthenticated mutation blocked: `{"status": 401}`
- PASS — Authenticated simulated auction created: `{"status": 201, "mode": "simulation", "payment_mode": "simulation"}`
- PASS — Separate browser workspace cannot read auction: `{"status": 400, "body": {"error": "Auction not found"}}`
- PASS — Auction finishes within five rounds: `{"status": "completed", "rounds": 5, "reason": "max_rounds"}`
- PASS — Winner locks simulated placement: `{"brand": "ritual"}`
- PASS — Billable click receipt: `{"status": 200, "amount_cents": 104, "publisher_cents": 83, "network_cents": 21}`
- PASS — Duplicate click returns original charge: `{"status": 200}`
- PASS — One charge with 80/20 split: `{"charge_count": 1}`
- PASS — Workspace ledger isolation: `{"unrelated_workspace_charges": 0}`

Live GPT availability is reported by deployment, not executed by this verification. Stripe sandbox is not configured according to deployment capabilities at verification time.

## Post-design deployment check

2026-09-28T20:38:55.073180+00:00; deployment `fa00e9ec-2089-4894-8d62-d8c03da78f53`. This follow-up executed real GPT agent requests with explicitly simulated accounting, while Stripe sandbox configuration was available.

- PASS — Post-design bootstrap and recorded replay: `{"status": 200, "capabilities": {"live_agents": true, "stripe": true, "model": "gpt-5.4-mini", "demo_only": true}, "recorded_id": "recorded:24ef6e93-f0e5-49b3-b99d-71cb21c1a861", "recorded_rounds": 5}`
- PASS — GPT with explicit simulated money while Stripe configured: `{"status": 201, "mode": "live", "payment_mode": "simulation", "publisher_id": "wavelength"}`
- PASS — Remote GPT auction completes: `{"auction_id": "53261755-b569-41fc-a9d6-68f6283b20e2", "status": "completed", "rounds": 5, "end_reason": "no_change", "error": null}`
- PASS — Publisher attribution frozen through live selection: `{"winner": "sightglass", "winner_bid_cents": 75, "highest_cash_brand": "blue-bottle", "highest_cash_bid_cents": 180}`
- PASS — Live agents keep simulated transaction mode: `{"status": 200, "mode": "simulation", "amount_cents": 75, "publisher_cents": 60, "network_cents": 15}`

Cash comparison is observed, not forced: {"winner": "sightglass", "winner_bid_cents": 75, "highest_cash_brand": "blue-bottle", "highest_cash_bid_cents": 180}. Separate actual Stripe transfer evidence is documented in `STRIPE-VERIFICATION.md`.

## Live GPT coverage for fashion and outings

Real remote GPT requests completed against the deployed Worker with explicit simulated funds. These checks exercise the same API, auction runner, click ledger and publisher attribution as the café scenario. Full response snapshots are in ignored `test-results/remote-live-fashion.json` and `test-results/remote-live-outings.json`.

- PASS — `{"scenario": "fashion", "passed": true, "auction_id": "dd4afe63-13ae-4743-a381-87695406426e", "status": "completed", "rounds": 4, "end_reason": "all_final", "publisher_id": "wardrobe", "winner": "allbirds", "mode": "live", "payment_mode": "simulation", "click": {"id": "click:20d81e1b-b6de-42de-af3c-f06cbf033a39", "kind": "click", "created_at": "2026-09-28T20:39:26.891Z", "brand_id": "allbirds", "publisher_id": "wardrobe", "auction_id": "dd4afe63-13ae-4743-a381-87695406426e", "amount_cents": 120, "publisher_cents": 96, "network_cents": 24, "mode": "simulation", "status": "completed"}}`
- PASS — `{"scenario": "outings", "passed": true, "auction_id": "ef654003-5aa8-4472-bda1-f59a5075b5ac", "status": "completed", "rounds": 5, "end_reason": "all_final", "publisher_id": "cityguide", "winner": "exploratorium", "mode": "live", "payment_mode": "simulation", "click": {"id": "click:aa6d0e1e-c6db-4ccd-9370-d61f69097dc8", "kind": "click", "created_at": "2026-09-28T20:39:26.888Z", "brand_id": "exploratorium", "publisher_id": "cityguide", "auction_id": "ef654003-5aa8-4472-bda1-f59a5075b5ac", "amount_cents": 120, "publisher_cents": 96, "network_cents": 24, "mode": "simulation", "status": "completed"}}`
