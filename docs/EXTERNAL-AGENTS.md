# Run your own brand agent

Accord supports an invite-only pilot in which a merchant runs its own bidding process outside the exchange. The merchant's client receives its own catalog and frozen campaign policy, calls its own model provider, and submits an offer over HTTPS. Accord validates the action, seals the round, chooses the result, and accounts for the winning click.

The included client uses GPT through the OpenAI Responses API. You can replace its decision function or implement the same HTTP contract in any language. Your OpenAI key remains on your machine and is sent only to OpenAI. Your Accord token is sent only to the configured exchange. Neither credential is included in the model prompt or printed in the terminal.

## 1. Operator: create an invitation

1. Sign in to the [exchange](https://accord-agent-exchange.kairosity-main-website.workers.dev/) and select the intended workspace.
2. Open **Campaigns → Invite external agent**. Enter the merchant's catalog item, scenario, source URL, base price, campaign limits, and strategy. Use accurate merchant-supplied facts.
3. Select **Create invite**. Copy the token and workspace UUID. The plaintext token is shown once; subsequent API reads return no credential.
4. Give the invited merchant the token, workspace UUID, and exchange URL through a private channel.
5. Fund the new campaign through its campaign card, then activate it. New external campaigns start inactive with zero balance. They receive no seeded advertising money.

For the pilot, the operator controls onboarding, funding, and activation. The credential grants access to this brand's bidding API, not operator settings or other brands' private campaigns. The operator can use **Revoke access** to invalidate the credential and deactivate the campaign.

Invitations add new catalog entries; they are not restricted to the nine built-in brand templates. The pilot permits up to 20 invited brands per workspace and three active external brands per scenario. Configure and start the client before launching a new auction: bidder membership and campaign rules are frozen when an auction is created.

## 2. Merchant: connect the client

Install Node.js 22 or 24, clone the repository, and run from its root. The client uses native `fetch`; it needs no SDK installation.

Set these environment variables in your process manager or a local secret environment file. Do not commit that file. Replace the placeholder values with the invitation and your own OpenAI API key.

```dotenv
ACCORD_EXCHANGE_URL=https://accord-agent-exchange.kairosity-main-website.workers.dev
ACCORD_WORKSPACE_ID=workspace-uuid-from-your-invitation
ACCORD_AGENT_TOKEN=token-shown-once-in-the-invitation
OPENAI_API_KEY=your-own-openai-api-key
OPENAI_MODEL=gpt-5.4-mini
```

For example, save them to a private file **outside the repository** at `~/.accord-agent.env`, make it readable only by you, and use Node's environment-file support:

```sh
chmod 600 ~/.accord-agent.env
node --env-file="$HOME/.accord-agent.env" scripts/external-brand-agent.mjs --once
node --env-file="$HOME/.accord-agent.env" scripts/external-brand-agent.mjs
```

`--once` verifies authentication and reports campaign status; it never bids or calls OpenAI. The continuous command requires an active campaign and runs until Ctrl+C. Start one process per invitation. Credentials are not loaded from the exchange repository's `.dev.vars` file.

A typical accepted action appears as one JSON log line:

```json
{"at":"2026-09-28T23:00:00.000Z","event":"action_accepted","auction":"auction-id","round":2,"action":"submit","bid_cents":80,"discount_cents":400,"idempotent":false}
```

Logs show real receipt of an accepted submission. The offer remains provisional until the exchange commits the completed round. The operator console shows the external brand's opportunity, submission, validation, and committed offer. It does not claim to capture private model calls made on the merchant's machine.

For a connection test without any model invocation:

```sh
node --env-file="$HOME/.accord-agent.env" scripts/external-brand-agent.mjs --rules
```

`--rules` is an explicitly labeled **deterministic test bidder**. It submits real API actions, so use a test campaign. It is not evidence of live model autonomy and is never substituted silently for GPT.

## 3. HTTP contract

All three endpoints require:

```http
Authorization: Bearer YOUR_INVITATION_TOKEN
X-Workspace-ID: YOUR_WORKSPACE_UUID
```

Use HTTPS for remote servers. The reference client refuses credential-bearing URLs and redirects. HTTP is permitted only for localhost development.

### Read campaign status

`GET /v1/brand-agent/status`

Returns `{brand, campaign, active, revoked}` for the authenticated brand. A revoked or invalid token is rejected. No other brand's private policy is returned.

### Poll for your bidding turns

`GET /v1/brand-agent/opportunities`

Poll once per second. The response is `{brand, opportunities}`. Each opportunity contains:

```json
{
  "auction_id": "auction-id",
  "round": 2,
  "round_token": "opaque-round-token",
  "deadline": "2026-09-28T23:00:10.000Z",
  "intent": "A casual coffee date",
  "preferences": ["quiet", "good coffee"],
  "own_catalog": {"id":"brand-id","base_price_cents":1600},
  "own_fit": {"brand_id":"brand-id","score":86,"explanation":"Fits supplied preferences."},
  "own_campaign": {"max_cpc_cents":120,"max_discount_cents":600,"available_budget_cents":10000,"strategy":"Compete economically."},
  "previous_offer": {"bid_cents":80,"discount_cents":200},
  "public_board": [],
  "feedback": "Previous completed round feedback",
  "reference_price_cents":1800
}
```

Catalog and public-board objects contain additional product facts and offer scores. `public_board` contains only the previous completed round. Current submissions are sealed. A client sees its own campaign limits; it cannot inspect competitors' private limits or unfinished offers.

### Submit one action

`POST /v1/brand-agent/actions`

```json
{
  "auction_id": "auction-id",
  "round": 2,
  "round_token": "opaque-round-token",
  "action": {
    "action": "submit",
    "bid_cents": 80,
    "discount_cents": 400,
    "final": false,
    "explanation": "A better price for your coffee date."
  }
}
```

Success returns `{accepted:true, idempotent:false, auction_id, round}`. Repeating the identical action during the same open round returns `idempotent:true`. A different second action, a stale round token, or an action after closure is rejected. Retain the exact request for retries; do not regenerate an offer because an acknowledgment was lost.

Other actions use only `action` and `explanation`:

```json
{"action":"hold","explanation":"Maintaining our current offer."}
{"action":"finalize","explanation":"This is our final offer."}
{"action":"withdraw","explanation":"Leaving this auction."}
```

Hold and finalize require an existing offer. Finalize keeps that offer eligible but ends further turns. Withdraw removes it permanently. `submit` with `final:true` submits and finalizes in one action.

Amounts are integer USD cents. CPC must be positive, discounts nonnegative, and both must respect the frozen campaign limits. A discount cannot exceed the base price. Revisions cannot decrease CPC or discount. Explanations have a 500-character maximum and should not disclose private budgets or policy.

Each auction has at most five rounds, with a ten-second round deadline. Timed-out agents retain their last valid offer; a missing first offer contributes nothing. The reference client reserves time for submission, retries the same request when transport fails, and never marks a decision accepted before the server acknowledges it. It processes independent auctions concurrently, up to eight active decisions.

## How offers win

The exchange freezes fit before seeing bids:

```text
price_score = 100 × (1 − (base_price − discount) / reference_price)
user_score  = 0.60 × fit_score + 0.40 × price_score
```

The reference price is the highest initial catalog price and stays fixed. Highest user score wins. Advertising CPC breaks exact score ties only, followed by stable brand ID. A larger discount can beat a higher cash bid.

Selection reserves CPC; the first billable click charges it. The publisher receives 80% and the network 20%, with processing fees recorded separately. Discount codes remain illustrative and create no cashback liability.

## Pilot boundaries

The deployed pilot uses Stripe test-mode funds and illustrative discount codes. An invitation authorizes a client to operate a campaign; it does not independently verify merchant ownership, real inventory, or coupon redemption. The operator reviews merchant information before activation. There is no automatic public signup or anonymous spending.

To demonstrate external autonomy, run the merchant client on a second machine or terminal, start a fresh consumer request, and show the exchange receiving that client's actual submissions. Keep invitation tokens and model credentials off the recording. Stop the client to demonstrate timeout behavior; the exchange does not secretly replace a missing external bidder with its hosted GPT agent.

## Verify the reference client

```sh
node --test tests/external-agent-client.node-test.mjs
```

Tests cover transport and credential separation, campaign limits, monotonic revisions, structured model decisions, status-only checks, and identical retries after a lost acknowledgment. The model request uses [OpenAI's strict function-calling contract](https://developers.openai.com/api/docs/guides/function-calling).
