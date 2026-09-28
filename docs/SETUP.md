# Setup, deployment, and API

This guide describes the terminal console, scoped publisher authentication, and invite-only external brand participation. Older verification documents preserve earlier deployment evidence, not the current setup instructions.

## Local development

Use Node.js 24 and run commands from the repository root.

```sh
npm ci
# First setup only; never overwrite an existing populated file.
cp .dev.vars.example .dev.vars
```

Configure the ignored `.dev.vars`:

| Setting | Purpose |
|---|---|
| `OPENAI_API_KEY` | Live user-agent and hosted brand-agent model calls; external clients supply their own key |
| `ADMIN_TOKEN` | A long random operator credential; required for remote sign-in |
| `PUBLISHER_API_KEYS` | JSON object with distinct random values for `wavelength`, `wardrobe`, and `cityguide` |
| `STRIPE_SECRET_KEY` | Optional Stripe sandbox key |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the endpoint receiving Stripe events |
| `STRIPE_PUBLISHERS` | JSON map of those publisher IDs to sandbox connected-account IDs |

The publisher map has this shape; replace each placeholder with a different random secret:

```dotenv
PUBLISHER_API_KEYS='{"wavelength":"replace-dating-key","wardrobe":"replace-shopping-key","cityguide":"replace-outings-key"}'
```

`PUBLISHER_API_KEY` is a local-only legacy fallback when the map is absent. A deployed exchange requires the named map; a shared legacy key is rejected remotely. Keep all credentials out of browser variables, URLs, and source control.

`OPENAI_MODEL` is a non-secret Wrangler variable, currently `gpt-5.4-mini`. The separate consumer apps always request live models. Stripe is optional for local live negotiation: the consumer runner defaults to explicitly simulated funds.

```sh
npm run build:all
npm run dev:all
```

This starts exchange/dating/shopping/outings at ports **8787/8788/8789/8790**. It generates ignored local consumer configuration with the corresponding publisher key, uses local HTTP instead of deployed service bindings, and leaves remote workspace funds untouched. Stop the four servers with Ctrl-C.

For frontend hot reload, run `npm run dev` separately and use port 5173; API requests proxy to the Worker. Rebuild consumer assets after consumer UI changes. For exchange-only work, use `npm run build` then `npm run preview`.

## Workspace configuration

- `OPERATOR_WORKSPACE_ID` in `wrangler.jsonc` is the stable private owner workspace UUID. Changing it selects a different workspace; it does not migrate stored state.
- `DEMO_WORKSPACE_ID` is the shared example integration workspace UUID, identical in the exchange and all three consumer configs.
- Named publisher keys are bound to that integration workspace and to their publisher identity. They cannot select the private owner workspace.
- Local API access permits localhost development. Do not expose the local server as a public deployment or treat that bypass as remote authentication.

Open a consumer's **Open exchange** link to view its workspace. That link also carries the auction ID once a request exists. The exchange root opens the configured private owner workspace after sign-in. It no longer automatically joins the shared integration workspace.

## Invite an external brand

Open **Campaigns → Invite external agent**, enter the catalog and campaign policy, then select **Create invite**. The operator receives a brand-scoped token once. Give the merchant that token, its workspace UUID, and the exchange URL privately; do not give it `ADMIN_TOKEN`, publisher credentials, or the exchange's model key.

**For requests from the deployed consumer apps, create the invitation in the shared integration workspace.** Reach it through a consumer's **Open exchange** link. Inviting in the private owner workspace creates a separate brand there; it will not receive the public example apps' traffic.

External campaigns start inactive with zero funds. Fund the campaign in the intended money mode, activate it, and start the merchant's client before creating a new auction. Membership and campaign limits are frozen at creation. The client runs on the merchant's machine with its own OpenAI key; it receives only its own private campaign context and the previous public board. The reference client uses GPT rather than Anthropic.

```sh
# Run with ACCORD_AGENT_TOKEN, ACCORD_WORKSPACE_ID, and your own OPENAI_API_KEY set.
node scripts/external-brand-agent.mjs --once
node scripts/external-brand-agent.mjs
```

The first command checks access without bidding. The second polls for turns and submits actual offers. See [EXTERNAL-AGENTS.md](EXTERNAL-AGENTS.md) for complete configuration, the HTTP contract, retries, and the explicitly deterministic `--rules` test mode. **Revoke access** invalidates the invitation and deactivates its campaign. Registration is operator-controlled; merchant ownership and catalog facts are not independently verified. Payments and discount codes remain sandbox/illustrative.

## Stripe sandbox

Follow [Stripe setup](../README-STRIPE.md). A new workspace has simulated balances but starts with zero Stripe sandbox balance. Existing funding in another workspace does not carry over.

The default local flow uses live GPT with simulated money. After configuring and funding the correct local workspace, enable sandbox money explicitly:

```sh
LOCAL_PAYMENT_MODE=sandbox npm run dev:all
```

Use the signing secret belonging to the actual endpoint. A Stripe CLI listener and a deployed webhook have different signing secrets. Register both `checkout.session.completed` and `charge.updated` so asynchronously available processing fees can reconcile. Customer codes are illustrative; there is no redemption endpoint.

## Deploy

The following commands use the existing project's Worker names. For your own Cloudflare account, first review and update all four Wrangler configs: Worker/service names, consumer `EXCHANGE_URL`, the shared integration UUID, and the owner UUID. The exchange also lists the hosted consumer URLs in `src/server/index.ts`; update those operator-console links when hosting elsewhere.

```sh
npx wrangler login
npm run typecheck
npm test
npm run build:all
npm run deploy
node scripts/deploy-secrets.mjs
npm run deploy:consumers
node scripts/deploy-secrets.mjs --publishers
```

These deploy one exchange Worker with a SQLite Durable Object binding and three separate consumer Workers. `deploy-secrets.mjs` reads `.dev.vars` and uploads values over standard input; it does not put credentials in source assets. Its `--publishers` mode gives each consumer only its own key as `EXCHANGE_API_KEY`. Do not announce a fresh deployment ready until secret upload and a consumer request both succeed.

When rotating existing publisher credentials, coordinate exchange and consumer updates to avoid a temporary mismatch. Do not deploy during an active presentation. The deployment scripts do not provide an automatic multi-Worker rollback mechanism.

After registering the Stripe webhook, add its secret to `.dev.vars` and upload exchange secrets again. Checkout redirects alone do not credit funds; verified payment success does.

## Authentication

`POST /api/session` accepts `{ "token": "operator credential" }` and issues an eight-hour signed `accord_session` cookie with HttpOnly, Secure, and SameSite=Strict attributes on the deployed origin. `GET /api/session` checks authentication; `DELETE /api/session` signs out. The console sign-in page manages this flow. An `x-admin-token` header is also supported for operator tools.

The single operator credential is a founder-console mechanism. It is not individual user accounts, organization roles, or OAuth. Do not share it with judges or embed it in a presentation URL.

Publisher servers send:

```http
Authorization: Bearer <this publisher's key>
X-Workspace-ID: <configured integration workspace UUID>
Content-Type: application/json
```

They can create/read/control their own auctions and record their own placement clicks. They do not receive private campaign limits, agent traces, or the operator ledger. The browser calls its consumer server, so the publisher key never reaches client code.

## API reference

| Route | Caller and purpose |
|---|---|
| `GET/POST/DELETE /api/session` | Operator session check/sign-in/sign-out |
| `GET /api/bootstrap` | Authenticated workspace snapshot; publisher view is restricted |
| `POST /api/demo/:scenario/auctions` | Operator test-request adapter; scenario is server mapped |
| `POST /v1/auctions` | Publisher request; scenario and publisher identity must match its key |
| `GET /v1/auctions` | Recent auctions within caller scope |
| `GET /v1/auctions/:id` | Persisted auction; full operator view or limited publisher result |
| `POST /v1/auctions/:id/actions` | `accept`, `cancel`, `pause`, `continue`, subject to ownership |
| `POST /v1/placements/:id/click` | Idempotent CPC charge and approved merchant destination |
| `PATCH /v1/campaigns/:brandId` | Operator campaign version update |
| `POST /v1/campaigns/:brandId/fund` | Operator Stripe sandbox Checkout |
| `POST /api/simulation/fund/:brandId` | Operator simulated funding |
| `GET /v1/brand-agents` | Operator list of invited brands and client contact status |
| `POST /v1/brand-agents` | Operator registration; returns a one-time scoped token |
| `POST /v1/brand-agents/:brandId/revoke` | Operator revocation and campaign deactivation |
| `GET /v1/brand-agent/status` | Invited brand's own catalog, campaign, and activation status |
| `GET /v1/brand-agent/opportunities` | Invited brand's open sealed-round turns |
| `POST /v1/brand-agent/actions` | Authenticated, bounded action for an open round |
| `GET /v1/ledger` | Operator financial journal |
| `POST /v1/stripe/webhook` | Signed Stripe events; signature verification replaces operator authentication |

Example publisher request body:

```json
{
  "scenario": "dating",
  "publisher_id": "wavelength",
  "intent": "Find a casual coffee date spot in San Francisco.",
  "preferences": ["Coffee for two", "Casual first date"],
  "mode": "live",
  "payment_mode": "sandbox",
  "max_rounds": 5,
  "target_score": 85
}
```

A consumer Worker exposes `GET /api/context`, `POST /api/auctions`, `GET /api/auctions/:id`, and `POST /api/placements/:id/click`. It selects scenario, publisher, and modes on the server. Its click body includes `auction_id` to verify the placement belongs to that request.

Publisher IDs and built-in templates remain configured in code. Operators can add external brands through `POST /v1/brand-agents`; those entries are persisted dynamically and do not require a deployment. There is no anonymous brand signup, unrestricted publisher self-registration, or merchant redemption API. External brand requests use their invitation token as Bearer authorization and their invitation workspace as `X-Workspace-ID`; this does not grant operator or publisher access.

## Verification and recordings

```sh
npm run typecheck
npm test
node --test tests/external-agent-client.node-test.mjs
npm run build:all
```

Verification includes 327 Vitest tests and 7 native Node external-client tests. The final sealed-window change is tested with persisted submissions and a deadline advance, including no duplicate model dispatch. Historical runtime evidence is linked from [STRIPE-VERIFICATION.md](STRIPE-VERIFICATION.md) and [FOUR-APP-VERIFICATION.md](FOUR-APP-VERIFICATION.md).

The console's **History** shows persisted completed auctions as read-only replays. The older `examples/live-value-auction.json` is a separate recorded fixture using simulated funds; it is not automatically injected into every workspace and must not be described as the newer Stripe-funded run. Provider traces exist only for auctions created after trace instrumentation was deployed.
