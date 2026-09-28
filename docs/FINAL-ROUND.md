# Final-round playbook

Prepared September 28, 2026. Presentation length has not been announced. Use the 90-second core, add the three-minute material, and keep the five-minute extensions optional.

## The one thing judges should remember

**Accord is the exchange where brands negotiate with AI assistants to earn recommendations by giving users better offers.**

We own the negotiation protocol and transaction system. The dating, shopping, and outings apps demonstrate three integrations with it. Avoid spending the pitch introducing three separate consumer products.

The signature moment is a lower advertising bidder winning through better personal fit and effective price. Show that comparison when it actually happens. A live auction can select the highest cash bidder; its outcome is not scripted.

## Match the judging criteria with visible evidence

Judging runs **3:30–5:00 PM Pacific**. Judges may review the submission or request a live demonstration. The announced video limit is **2–3 minutes**; the live final-round slot is still unknown. Prepare a 90-second core and a three-minute version without assuming a longer slot.

| Criterion | What to show | What to say precisely |
|---|---|---|
| Progress in 8 hours | Four deployed apps, working request-to-placement flow, operator invitation, persisted receipt | “The exchange and reference apps are deployed and usable. We added an invitation path for a brand to connect its own agent.” |
| Agent autonomy | An independent external client receives a turn, uses its own GPT key, and submits an offer; later rounds react to the public board | “After campaign setup, this process negotiates without an operator approving each offer. The exchange validates and settles the result.” |
| Technical execution | Scoped credentials, actual external submission trace, sealed rounds, durable state, Stripe test transfer | “Cloudflare runs the exchange and persistent coordination. Stripe handles test funding and Connect transfers. GPT powers our selected model implementation.” Do not claim Brainbase Labs or Anthropic integration; neither is used. |
| Startup potential | One plausible publisher customer and the CPC receipt | “A consumer AI publisher integrates intent and recommendations; participating merchants supply offers. Our current revenue mechanism is 20% of click charges, before costs.” |
| Demo quality | One coherent consumer → exchange → consumer → receipt journey | State which agent runs externally, show actual amounts, label test payments, and stay within the allotted time. |

The new invitation path is implemented, but **we have not validated an independent third-party merchant pilot**. If we run the external process ourselves, call it a separately operated client that demonstrates the integration contract—not a merchant partnership or outside adoption.

## Recommended presentation: three minutes

| Time | Screen and action | Narration |
|---|---|---|
| 0:00–0:20 | Dating app, fresh chat. | “When an AI assistant recommends where to go or what to buy, a commercial decision is being made. We built Accord so brands can compete on the deal they give the user.” |
| 0:20–0:35 | Click **Find a café for us**, then **Open exchange** immediately. | “Here, two people matched and want a coffee date. The app sends their intent and relevant preferences to our exchange.” |
| 0:35–0:55 | Incoming request and agent terminals; briefly show the prestarted external client terminal. | “This invited brand runs in a separate process with its own model key. It receives its bidding turn from Accord and submits an offer over the API. Hosted competitors respond independently. Every offer combines CPC for the publisher and a customer discount.” |
| 0:55–1:15 | Open **Network trace** and the external submission or committed offer. | “This is the actual external submission. Agents see the same previous completed board and only their own private campaign policy. Fit was assessed before bidding. Accord validates the action and commits the sealed round.” |
| 1:15–1:40 | Offer board and selection comparison. If still running, optionally accept a completed round. | “We rank on fit and price after discount. Cash only breaks exact score ties. Read the current offers here: [winner] offers [discount], at [CPC].” If the cash leader differs: “That brand bid more for the click, but this offer is better for the user.” |
| 1:40–2:05 | Return to the dating app. Show the recommendation, then click **View café**. | “The actual winning offer returns to the originating app. The advertiser is charged only on the first click.” |
| 2:05–2:25 | Return to the exchange receipt; show the actual status. | “The exchange records the charge and splits it: 80% to the publisher, 20% network gross. This is Stripe test mode.” Say “transfer completed” only if the receipt confirms it. |
| 2:25–2:40 | Show the invited brand in Campaigns, with credentials dismissed; mention Thread and Roam briefly. | “Brands can now connect their own agents through an operator invitation. The same exchange serves our dating, shopping, and outings integrations.” |
| 2:40–3:00 | Return to the console. | “We are starting with consumer AI publishers and a small set of merchants. The exchange earns 20% of click charges before costs. Our next milestone is an independent merchant pilot measuring user value, publisher revenue, and model cost.” |

Use actual on-screen figures. Keep cursor motion slow, select one payload, and collapse it before returning to the offer board. Do not narrate every log entry.

## Ninety-second core

Use this compressed live sequence; [RECORDING-SCRIPT.md](RECORDING-SCRIPT.md) remains a supporting script for the original café flow.

| Time | Action and narration |
|---|---|
| 0:00–0:15 | Click **Find a café for us**, then **Open exchange**. “Accord lets brands compete for AI recommendations by offering a better deal to the user.” |
| 0:15–0:35 | Show the already-running external terminal and its accepted action. “This brand's process uses its own GPT key and submits directly to our deployed exchange. It runs without per-offer human approval.” |
| 0:35–1:00 | Show the committed board and actual comparison. “We rank frozen personal fit and price after discount; cash only breaks ties. Here are the offers this run produced.” Accept a completed board if useful. |
| 1:00–1:20 | Return to the consumer, show the winner, click through, then show the receipt's actual status. “The first click triggers CPC accounting: 80% publisher, 20% network gross. These are Stripe test-mode transactions.” |
| 1:20–1:30 | “The exchange is deployed, and external agents can join by invitation. Next we need an independent merchant pilot and measured unit economics.” |

Preconfigure and start the client before presenting; do not reveal or issue credentials on stage. If a full live run would overrun the slot, accept the last completed board or explicitly show a previously completed receipt. Never compress a pending transfer into a claim of completion. Live rounds can finish early; five full windows take about 50 seconds plus fit assessment and scheduling. The 90-second version is for a short live slot, not a substitute for the announced 2–3-minute submission-video limit.

## Five-minute extensions

Add these only if time permits:

- **External autonomy, 30 seconds:** show the independent process receiving a new turn and submitting an accepted action. Distinguish it from the read-only terminal subscriber. If time permits, stop it before a later round and show the actual timeout; hosted GPT does not secretly replace it.
- **Campaign controls, 30 seconds:** show a campaign's CPC limit, discount ceiling, and strategy. Explain that the next auction freezes a version; editing a campaign cannot rewrite an active auction. Keep credentials off-screen.
- **Persistence, 20 seconds:** refresh the exchange during a round. The request ID and committed rounds remain. This demonstrates the server owns execution.
- **Economics, 30 seconds:** explain the low-CPC issue and proposed publisher floor described below. Separate today's behavior from proposed changes.
- **Personalization, 40 seconds:** change the consumer's request and start a new auction. Show the changed input and fit assessment, not a promised different winner. Do this instead of running all three scenarios in full.

## What to improve next, in order

Invite-only external onboarding and the reference bidding client are implemented; see [EXTERNAL-AGENTS.md](EXTERNAL-AGENTS.md). The improvements below remain proposed tasks. Do not describe an unimplemented publisher floor or fast mode as shipped.

| Priority | Change | Why it matters | Completion evidence |
|---|---|---|---|
| 1 | Publisher minimum CPC, frozen per request | Today's scoring gives agents little incentive to pay above one cent. A floor establishes minimum publisher compensation while preserving user-value ranking. | Below-floor offers are rejected; no funded qualifying offer yields no placement; higher cash alone still cannot defeat a higher user score; floor appears in the audit record. |
| 2 | Operator **Prepare live run** control and explicit follow-latest status | Starting from old results makes a running product look like a static recording. | Preparing clears only the presentation selection, never auctions or money; a new consumer request automatically becomes visible; replay/pinned/live states are distinguishable. |
| 3 | Compact live round countdown and submission status | Ten-second windows currently leave a gap between fast model responses and committed offers. | Countdown uses the persisted server deadline; statuses distinguish request sent, response received, validated, and committed; no fake typing or hidden policy leakage. |
| 4 | Named execution modes: observable and fast | Full windows help a presentation but impose unnecessary delay on ordinary users. | Observable retains ten-second windows; fast can seal once all expected submissions finish; both keep the same fairness, timeout, restart, and acceptance invariants. Benchmark actual latency before making a performance claim. |
| 5 | Request-focused observability and direct placement lookup | Bootstrap currently sends a large workspace snapshot each second; publisher click authorization searches a capped recent-auction list. | Poll just the selected request with pagination for history; authorize a placement directly against its stored publisher/workspace so older valid reservations are not lost behind a list limit. |
| 6 | Measured cost and decision quality report | An operating exchange must support its model cost and latency with useful outcomes. | Record real model usage, total request time, rounds, discount changes, CPC, and publisher/network gross; compare policies on a fixed request set without claiming conversion lift. |

**Recommendation if there is only one hour:** first verify one external client through the deployed consumer flow, including a committed offer and scoped access. Rehearse it with the existing payment path. Only then consider the publisher floor or presentation reset/status if there is enough time for regression testing. A floor can make bids cluster at the floor; it establishes a minimum, not an incentive-compatible auction or proof of profitability. Treat its value as a publisher-set commercial parameter, not a magic number chosen to force a winning brand.

**If there are only 15 minutes:** freeze application code. Prepare tabs and a verified historical fallback, check balances, rehearse the handoff, and use the README as supporting material.

**After the finals:** merchant-authorized offers and redemption; user-facing paid-placement disclosure and consent controls; publisher account provisioning; API quotas and abuse controls; retention/privacy controls; request and spend limits; production payment readiness; and a real pilot. Current operator authentication is not a complete public SaaS onboarding system.

## Economics: answer this directly

**“Why would an agent bid more than one cent?”**

“In the current policy, it often wouldn't. CPC only breaks score ties, and we observed one-cent bids. The next policy we want to test is a publisher-defined reserve CPC, with user-value ranking among qualifying offers. Alternatively we can charge a fixed fee. We haven't proved the best pricing mechanism or unit economics yet.”

Do not respond by saying an LLM's premium strategy will make it voluntarily pay more forever. That is not an economic guarantee.

With the current split:

```text
network gross per click = CPC − floor(0.80 × CPC)
expected gross per request ≈ click probability × network gross per click
request contribution ≈ expected gross − model costs − allocated processing/operating costs
```

Customer discounts are separate brand concessions in the proposed business and illustrative today. They are not network revenue. Measured click/conversion lift, real merchant margins, and partner willingness to pay are unknown.

## Likely judge questions

| Question | Answer |
|---|---|
| What did you actually build? | Four deployed Workers; live GPT fit/bidding; a durable auction state machine; an authenticated operations console; publisher adapters; invite-only external brand registration and action APIs; a standalone bidding client; CPC accounting; and verified Stripe sandbox transfers. |
| What is agentic? | After an operator sets limits and activates a campaign, an external brand process can receive turns, use its own model to choose or revise offers, and submit without per-turn approval. Hosted agents also choose structured actions. The exchange enforces rules and makes the deterministic selection. |
| Why not a rules engine? | For these fixed examples, rules could work. Our hypothesis is that agents become useful as requests and merchant policies become less structured. We should benchmark that hypothesis rather than assume LLMs always add value. |
| Is the winner hardcoded? | No. Offers and winners vary. A lower-CPC winner is a supported and observed outcome, not a guaranteed presentation sequence. |
| Can a brand buy a better fit score? | Advertising bids are excluded from initial fit assessment; the score is frozen. Catalog quality and model reliability still need evaluation. |
| Why five rounds? | It is a bounded negotiation budget. Early stopping is supported. The right round count and latency budget need measurement. |
| Is this a real Blue Bottle partnership? | No. Real public catalog references, fictional campaigns and discounts. Our consumer apps are reference implementations, including a Wavelength-inspired example. |
| Do the CLI windows run the agents? | The external-brand-agent client actually calls its own model and submits offers. The console panes and watch-agent CLI are observers. Hosted brand agents run on the exchange server. Specify which process is on screen. |
| Has a real merchant joined? | The invite-only integration is implemented, but no independent third-party merchant pilot has been validated yet. Running our own external client proves the protocol, not outside adoption or merchant authorization. |
| Which sponsor tools did you use? | Cloudflare Workers and SQLite-backed Durable Objects, plus Stripe Checkout and Connect in sandbox. The chosen models are GPT. We did not integrate Anthropic or Brainbase Labs, and will not imply otherwise. |
| Is the money real? | Stripe sandbox funding and connected-account transfers are real API transactions in test mode, not live money or bank payouts. |
| Is this production ready? | Core execution is deployed and persistent. Public commercial operation still needs real merchant offers, account onboarding, abuse/privacy controls, measured performance, and live-payment readiness. |
| What is the moat? | Not today's code alone. Potential defensibility comes from publisher distribution, authorized merchant supply, policy integration, and demonstrated outcome quality. None is an established moat yet. |
| Who is the first customer? | A consumer AI publisher with purchase-intent conversations. Start with one publisher and a small set of participating merchants; the three example categories show reuse, not three simultaneous go-to-market plans. |

## Operator rehearsal

- Sign into the exchange before presenting. Use the consumer's workspace/request link, not the bare private-workspace root.
- Refresh both pages once before the session, then select **New chat**. Do not start the request until the presentation begins.
- Invite the external brand in the **consumer shared integration workspace**, not the private owner workspace. Fund and activate it before creating a fresh auction. Use accurate catalog facts and an illustrative code.
- Run `node scripts/external-brand-agent.mjs --once` with the invitation environment to verify access, then start the continuous client with its own OpenAI key. Keep the credential panel dismissed and environment values off-screen. Use the GPT mode for the autonomy claim; `--rules` is explicitly a deterministic test.
- Check that the intended external and hosted campaigns are active and funded in the same Stripe sandbox workspace. Do not top up or reconfigure mid-pitch. Confirm the fresh auction actually includes the external brand; membership is frozen at creation.
- Confirm the publisher transfer capability and identify a completed historical receipt. Do not create more connected accounts merely for rehearsal.
- Keep the exchange in **Exchange**, not **History** replay or a test composer. Follow **Open exchange** after creating the consumer request.
- Click the selected recommendation before the ten-minute reservation expires. Selection alone does not charge funds.
- Use **Pause** between rounds if you need time to explain; **Continue** resumes. Never describe a paused trace as agents currently running.
- Keep the 90-second video or recorded history as a labeled fallback. Old auctions may have no provider trace, and recorded playback cannot create a new charge.

## If the live outcome is awkward

| Situation | Response |
|---|---|
| Highest cash bidder also wins | Explain the independent user-value ranking using the displayed scores. Use the documented historical lower-bid winner only as a clearly identified prior result. |
| Only one or two rounds happen | Explain the actual early-stop reason. Efficiency can be a valid result; do not force extra concessions. |
| External client has no turns | Check it was invited, funded, and active in the consumer integration workspace before the auction started. Do not imply it participated if the board contains only hosted brands. |
| Provider request fails | Show the visible failure, then use a labeled recorded run. Do not quietly substitute scripted agents. |
| Transfer is pending | Show the durable settlement job and explain retries do not charge the click again. Do not claim a completed payment. |
| Winner bids one cent | Explain the known reserve-price gap. A zero-cent publisher share means no transfer is due; use a historical nonzero transfer to show the plumbing. |
| Login expires | Reauthenticate off the projected screen; never display the operator token. |

## Verified backup numbers

Historical café run `2d9975c9-16d0-4e0b-b428-40744f47c5cc`: Ritual $0.90 CPC versus Blue Bottle $1.80, $4.50 customer discount, $11.50 effective price, $0.72 publisher credit, $0.18 network gross. Verified Stripe **test** transfer. See [STRIPE-VERIFICATION.md](STRIPE-VERIFICATION.md).

The README screenshot is a different run: Sightglass wins at $0.12 CPC with a $6.50 discount. Do not mix the screenshot's numbers with the Ritual receipt.
