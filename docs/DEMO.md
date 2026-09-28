# Accord: presenter handbook

**Opening line:** “Brands usually bid to reach you. In Accord, they also bid to give you a better deal—and your agent decides which offer deserves the recommendation.”

## Presenter prep

| App | Open before presenting | Role |
|---|---|---|
| Wavelength-inspired dating | [Dating demo](https://accord-dating-demo.kairosity-main-website.workers.dev) | Coffee-date conversation and returned recommendation |
| Accord | [Exchange](https://accord-agent-exchange.kairosity-main-website.workers.dev) | Incoming intent, fit, negotiation, selection, and receipt |
| Thread | [Shopping demo](https://accord-shopping-demo.kairosity-main-website.workers.dev) | Everyday-sneaker conversation |
| Roam | [Outings demo](https://accord-outings-demo.kairosity-main-website.workers.dev) | SF art/science conversation |

Keep the **dating and exchange tabs already open**. Use the dating app's **Open exchange** link to join its stage. All four configured servers share `ef5d07d4-fc2a-41d9-b0bc-e1869dfb8e7c`. The exchange observes requests automatically; the consumer receives the actual winner. These are four separate deployed Workers, with polished motion and typography, not screens of one simulated app.

- Use the existing prepared browser session. If needed, enter the exchange admin token once in **Connection settings** before presenting; pause, continue, and accept need it. Consumer publisher credentials stay server-side.
- Confirm **live GPT / sandbox funds**. All three consumer apps have completed actual Stripe test-mode funding, clicks, and publisher transfers. All nine brand campaigns are funded in the shared stage, and all three publisher transfer capabilities have been verified active. See [STRIPE-VERIFICATION.md](STRIPE-VERIFICATION.md) for the evidence.
- Start a fresh dating conversation if an old result is present. Send: **“We matched and want specialty coffee for two in San Francisco. We value a casual date and a good deal; pick a place we can enjoy together.”** This is the request from the verified signature run, not a guarantee of the same new outcome.
- Keep **Auction history** ready as a backup. A fresh live run makes new GPT decisions. **Read-only replay** shows previously recorded decisions and cannot charge a click. **Rule-based simulation** is a third, separately labeled mode; it is not GPT.
- A click must occur within the ten-minute reservation. Let a fresh winner complete, then click its consumer card. Read the current receipt before describing settlement as completed; a pending transfer is not a completed transfer.

## Primary walkthrough: 90–120 seconds

| Time | Action | Say |
|---|---|---|
| 0:00–0:15 | In the dating tab, show the match conversation, send the coffee request, and switch to the already-open exchange. | “Two people have matched and want coffee. Their app sends one recommendation request to Accord.” |
| 0:15–0:35 | Show the incoming request, publisher `wavelength`, and three fit assessments. | “This is the actual request arriving. Our user agent scores personal fit before seeing any advertising bids, then freezes that assessment.” |
| 0:35–1:05 | Watch brand offers and discounts change. Point to the cash bid, effective price, scores, and any highlighted **New leader** round. Optionally pause after a completed round. | “Each brand offers two things: payment for the click and a discount for the customer. The user score is 60% fit and 40% effective price. Agents negotiate for up to five rounds; cash only breaks an exact score tie.” |
| 1:05–1:20 | Accept the current best if useful, or let the exchange finish. Show the cash leader versus the actual winner. | “A brand can pay less for the click and still win by giving the customer a better deal.” Use the actual numbers on screen. If the cash leader also wins, say so and use the recorded evidence below. |
| 1:20–1:35 | Return to dating. Its actual winner card appears automatically. Show the price and demo code, then click **Take a look**. | “The negotiated offer comes back to the original conversation. Selection reserved CPC; this first click charges it once.” |
| 1:35–1:50 | Switch back to the exchange receipt/Transactions tab. | “The publisher earns 80%, the network 20%. This is Stripe sandbox money. Here is this run's charge and its transfer status.” Say **pending** if it is pending; point to a completed `tr_` entry only after it appears. |
| 1:50–2:00 | Briefly show Thread and Roam in their own tabs. | “Three consumer apps, nine brand agents, one exchange. We own the negotiation, personalized selection, attribution, and transaction service.” |

If rounds complete faster than the narration, inspect their completed timeline in history. Say **“Here is the run we just completed”** rather than implying those offers are still being submitted. If the live winner is also the highest cash bidder: **“That can happen; fit still matters. Here is a verified run where the customer discount changed the result.”** Do not repeatedly rerun while judges wait.

## Verified signature result: live consumer → exchange → Stripe

On **2026-09-28 at 21:01 UTC**, the deployed dating app initiated GPT auction `2d9975c9-16d0-4e0b-b428-40744f47c5cc` in the shared stage. All three café brands had verified $100 Stripe funding. Five rounds changed the leader **Sightglass → Blue Bottle → Ritual → Sightglass → Ritual**. The auction ended `all_final`.

| Final offer | Advertising CPC | Customer discount | Effective price | Frozen fit | Price score | User score |
|---|---:|---:|---:|---:|---:|---:|
| **Ritual — selected** | **$0.90** | **$4.50** | **$11.50** | 82 | 28.125 | **60.450** |
| Sightglass | $0.90 | $5.21 | $10.79 | 79 | 32.5625 | 60.425 |
| Blue Bottle — highest cash | $1.80 | $2.00 | $14.00 | 84 | 12.5 | 55.400 |

The base basket quotes were $16. Ritual's price score was `100 × (1 − 11.50 / 16) = 28.125`; its user score was `0.60 × 82 + 0.40 × 28.125 = 60.45`. Blue Bottle's was `0.60 × 84 + 0.40 × 12.5 = 55.40`. Ritual won despite a lower fit score and half the advertising bid. Sightglass's lower price alone also did not overcome Ritual's better fit. The engine used unrounded scores; the console may round displayed values.

The consumer click produced exactly one **$0.90** debit, **$0.72** publisher credit, and **$0.18** network gross. Stripe transfer **`tr_3UKlbYAXV45EOxtS2U9yb5LB`** was retrieved independently and verified as 72 cents, `livemode: false`. A repeated click returned the same ledger ID; only one charge and transfer were recorded. The user-facing code was `RITUAL-DEMO`, an illustrative discount code, not a redeemable merchant coupon.

Evidence: [STRIPE-VERIFICATION.md](STRIPE-VERIFICATION.md) and the local runtime artifact `test-results/dating-consumer-sandbox.json`. This was a real recorded outcome, not a prescribed winner or round sequence. For live presentation, read current figures instead of reciting these as if they just occurred.

Thread also completed a verified five-round consumer flow: Rothy's offered a **$0.80 CPC** and **$45 discount**, with a **$0.64 Stripe sandbox publisher transfer**, `tr_3UKlj9AXV45EOxtS0S5H9gQT`.

Roam's verified live consumer auction `c4c769d5-b66e-4604-968f-8c7ca2684a0c` selected Exploratorium with an **$0.85 CPC** and **$9 discount** on a $60 demo quote. Its click produced a **$0.68 publisher transfer**, `tr_3UKlufAXV45EOxtS1LnVckzr`, and $0.17 network gross. The transfer was independently retrieved from Stripe with `livemode: false`; evidence is in `test-results/outings-consumer-sandbox.json`. A connected-account transfer is not a bank payout.

## Backup when a model or network is unavailable

Open **Auction history** and explicitly announce **“Recorded live GPT negotiation; read-only replay.”** The bundled recording from `examples/live-value-auction.json` is an **earlier, different run** using simulated funds: Ritual's $1.45 CPC and $4.50 discount beat Blue Bottle's $1.80 CPC. Do not attach the newer $0.90/$0.72 Stripe figures to this bundled recording. It cannot bill or redeem an offer.

For the newer verified sandbox run, select its shared-stage history entry if available, or show its recorded receipt evidence. A missing history entry does not turn the bundled replay into that run. The optional **Start test request → Simulation** control exercises real exchange logic with rule-based decisions and simulated balances; identify that mode before starting it.

## Thirty-second backup pitch

“Accord is an exchange for recommendations inside consumer AI apps. Brand agents submit an advertising bid and a customer discount. The user agent chooses on personal fit and price after discount. In our verified live coffee-date run, Blue Bottle bid $1.80 for the click. Ritual bid only 90 cents, gave the user $4.50 off, and won. The offer returned to the dating app, and its click produced a 72-cent Stripe sandbox publisher transfer. We own the negotiation and transaction layer, so brands compete to give users a better deal.”

## Short answers for judges

- **What is agentic?** Separate GPT agents assess fit and choose structured negotiating actions using private campaign policies and the same previous completed offer board. The exchange validates and commits those actions.
- **Why not maximize CPC?** This demo deliberately selects on user value. Cash is a tie breaker; 60/40 is an inspectable demo policy, not a claim of optimal auction economics. Agents can choose very low CPCs, so production reserve pricing remains an economic design question.
- **What is real?** Separate consumer servers call the deployed exchange; GPT decisions, persistent rounds, winner return, click accounting, and verified Stripe sandbox transfers for all three apps run end to end.
- **What is fictional?** The consumer-brand integrations, campaigns, basket quotes where marked, and flat discount codes. No merchant endorsement, live inventory promise, or redeemable coupon is implied.
- **What do we own?** Request normalization, fit assessment, offer protocol, auction execution, selection, attribution, CPC reservation, click accounting, and settlement coordination.
- **What is intentionally absent?** Redemption, stacking, separate eligibility rules, production fraud detection, and live availability checks.

Tests in `tests/engine.test.ts`, `tests/agents.test.ts`, `tests/payments.test.ts`, and `tests/consumer-api.test.ts` cover mechanism and adapter behavior. External settlement claims come from the verified runtime evidence, not from unit tests alone.
