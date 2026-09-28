# Accord — an agent exchange

Brands compete with an advertising bid **and a customer discount**. A user agent chooses on fit and effective price. A brand can lose the cash auction and win the recommendation.

This is an independent hackathon project. Real brand/catalog references are combined with fictional campaigns, quotes, discounts, and consumer integrations. Nothing here creates a redeemable coupon or a merchant booking.

## Four independent servers

| App | Deployed demo | Local server |
|---|---|---|
| Accord exchange | [Open exchange](https://accord-agent-exchange.kairosity-main-website.workers.dev) | http://127.0.0.1:8787 |
| Wavelength-inspired dating | [Open dating app](https://accord-dating-demo.kairosity-main-website.workers.dev) | http://127.0.0.1:8788 |
| Thread shopping | [Open Thread](https://accord-shopping-demo.kairosity-main-website.workers.dev) | http://127.0.0.1:8789 |
| Roam outings | [Open Roam](https://accord-outings-demo.kairosity-main-website.workers.dev) | http://127.0.0.1:8790 |

Each app has its own Cloudflare Worker. The three consumer servers send authenticated recommendation requests to the exchange, then return the actual winner to their chat interfaces. They share consumer UI code but use distinct scenario configuration and publisher attribution. The exchange owns one SQLite Durable Object per workspace for auction state, campaign snapshots, and accounting.

The configured `DEMO_WORKSPACE_ID` joins all four apps to the same presentation stage. The exchange automatically joins that stage and observes incoming requests once a second; each consumer's **Open exchange** link also carries its stage ID. No auction is restarted by a browser refresh. Model requests and publisher credentials stay on the servers.

## Run locally

Use Node 22.12+ (Node 24 recommended).

```sh
npm install
cp .dev.vars.example .dev.vars # only on first setup; preserve existing secrets
npm run build:all
npm run dev:all
```

Before starting, set `OPENAI_API_KEY` and a nonempty `PUBLISHER_API_KEY` in the ignored root `.dev.vars`. Add `ADMIN_TOKEN` for deployed exchange controls. `dev:all` starts all four ports listed above and creates ignored local consumer configuration with the publisher credential copied as `EXCHANGE_API_KEY`. It points the consumer servers at the local exchange; it does not send those requests to the deployed exchange. Stop all four with Ctrl-C. Local consumer apps use live GPT agents with explicitly simulated funds by default, independently of the deployed Stripe configuration. To use Stripe locally after configuring and funding the local workspace, start with `LOCAL_PAYMENT_MODE=sandbox npm run dev:all`.

For exchange-only development, `npm run build` followed by `npm run preview` starts port 8787. For exchange frontend hot reload, run `npm run dev` in another terminal and open http://localhost:5173; its API calls proxy to that Worker. Use `build:all` after changing consumer UI assets.

`OPENAI_API_KEY` enables live GPT agents. `OPENAI_MODEL` is configured in `wrangler.jsonc` (currently `gpt-5.4-mini`). The separate consumer apps request live agents and fail visibly if they are unavailable. For offline rehearsal, use the exchange's **Start test request** control and choose the explicitly labeled rule-based simulation, or use a read-only recording. Simulation never pretends to be a live model response.

## The demo

1. Open the separate dating app, enter a coffee-date request in its conversation, and send it.
2. Follow **Open exchange**. The request appears automatically with its originating publisher; fit assessments happen before bids and remain fixed.
3. Watch live GPT agents negotiate for up to five rounds. All brands see the same previous completed board. Private budgets and ceilings stay private to each brand agent.
4. Compare the highest cash bidder with the best user-value offer. Inspect fit, price, and combined scores separately.
5. Pause between rounds, continue, accept the current best, or cancel. Acceptance uses the last completed round even if the next one is running.
6. Return to the dating app. Its actual winning recommendation arrives automatically with the negotiated price and demo code. Click it: the reserved CPC becomes one charge, with an 80/20 publisher/network split.
7. Briefly show Thread and Roam sending requests through the same exchange. Use **Auction history** to replay completed auctions without changing money or live state.

Consumer apps show natural recommendations inside an overall labeled demo environment. Their connection to this exchange is implemented; they are concept demos, not integrations with the real Wavelength product or featured merchants. The project has no affiliation with those brands. See [docs/DEMO.md](docs/DEMO.md) for the three-minute judges walkthrough and recorded numerical example.

## Auction contract

Amounts are integer USD cents. The item and base price are frozen. `effective_price = base_price - discount`. The reference price is the highest initial base price and never changes. `price_score = 100 * (1 - effective_price/reference_price)`. `user_score = 0.60 * fit + 0.40 * price_score`.

Advertising bid breaks exact score ties only, followed by stable brand ID. Offers can increase both amounts or hold, finalize, or withdraw. A finalized offer remains eligible. A withdrawn agent cannot rejoin. Invalid/late actions cannot replace a valid prior offer. Each simultaneous bidding round has a ten-second deadline; round one counts toward the five-round maximum.

Ending conditions are recorded explicitly: user acceptance, target score (default 85), all final, unchanged revision round, maximum rounds, no offers, cancellation, assessment failure, or insufficient funds. There is no separate inventory, fraud, coupon redemption, or stacking engine.

## Money modes

Live GPT and payment mode are independent. All three deployed consumers use **live GPT with Stripe sandbox funds** in the shared presentation stage. All nine campaigns have verified Checkout funding, and each publisher has completed an actual sandbox transfer. Each new workspace has $100 of simulated funds per brand; rule-based simulations always use those balances. Sandbox balances start at zero and receive credit only from verified Stripe payment success.

The exchange's test-request composer has separate agent and payment selectors. Consumer payment modes are configured in the corresponding Wrangler file. Dating, fashion, and outings are deployed with `DEMO_PAYMENT_MODE=sandbox`; their publisher transfer capabilities are active.

At selection the exchange reserves the winning CPC for ten minutes. The first click charges it atomically with publisher earnings and a durable settlement job. Duplicate clicks cannot charge twice. Expired reservations are released. Funding is deduplicated by webhook event and source charge; transfers use stable idempotency keys and retry without repeating the click charge. Processing fees are separate. Customer discounts do not create a cashback liability.

See [README-STRIPE.md](README-STRIPE.md) for Connect, Checkout, webhook, and test-card setup, and [docs/STRIPE-VERIFICATION.md](docs/STRIPE-VERIFICATION.md) for completed consumer sandbox flows. The café run records Ritual beating a higher cash bidder, a $0.90 click, and a $0.72 publisher transfer; the fashion run records a $0.80 Rothy’s click and a $0.64 publisher transfer. New workspaces still require funding.

## Deploy to Cloudflare

```sh
npx wrangler login
npm run deploy
node scripts/deploy-secrets.mjs
npm run deploy:consumers
node scripts/deploy-secrets.mjs --publishers
```

This deploys the dedicated `accord-agent-exchange` Worker and SQLite Durable Object namespace, then the three separate consumer Workers. It does not use Darwin Arena resources. Before deploying to another account, update each consumer's `EXCHANGE_URL` and use the same `DEMO_WORKSPACE_ID` in all four Wrangler configurations.

`deploy-secrets.mjs` reads the ignored `.dev.vars` and sends nonempty exchange credentials to Wrangler over standard input. Its `--publishers` option instead uploads only the publisher credential to each consumer Worker as `EXCHANGE_API_KEY`. Never put model, Stripe, admin, or publisher secrets in browser variables or checked-in configuration.

Remote exchange mutations require `ADMIN_TOKEN`; enter it in **Connection settings** to control auctions or campaigns. Local development allows localhost. Outside the shared presentation stage, browsers use HTTP-only workspace cookies. Consumer servers authenticate to the exchange with `Authorization: Bearer <PUBLISHER_API_KEY>` and their configured UUID `X-Workspace-ID`. The consumer browser calls its own server and never receives the publisher secret.

After deployment, register `/v1/stripe/webhook` as a Stripe sandbox webhook endpoint for `checkout.session.completed` and `charge.updated`, save its signing secret, and run the secrets upload again. The local Stripe CLI listener has a different signing secret from the deployed endpoint.

## API

| Route | Purpose |
|---|---|
| `GET /api/bootstrap` | Catalog, templates, capabilities, current workspace |
| `POST /api/demo/:scenario/auctions` | Simulated consumer adapter with server-controlled publisher identity |
| `POST /v1/auctions` | Authenticated publisher auction API |
| `GET /v1/auctions/:id` | Persisted auction and completed rounds |
| `POST /v1/auctions/:id/actions` | `accept`, `cancel`, `pause`, `continue` |
| `POST /v1/placements/:id/click` | Idempotent CPC charge and merchant destination |
| `PATCH /v1/campaigns/:brandId` | Versioned campaign configuration |
| `POST /v1/campaigns/:brandId/fund` | Sandbox Checkout |
| `POST /api/simulation/fund/:brandId` | Explicitly simulated funds |
| `POST /v1/stripe/webhook` | Verified advertiser funding |
| `GET /v1/ledger` | Funding, click, fee, transfer receipts |

Each consumer Worker provides `GET /api/context`, `POST /api/auctions`, `GET /api/auctions/:id`, and `POST /api/placements/:id/click`. Its scenario and publisher identity are server-controlled. It returns the consumer-facing auction result and checks scenario ownership before reads or clicks; the exchange remains the sole auction/accounting implementation.

## Verification

```sh
npm run typecheck
npm test
npm run build:all
```

Unit tests cover scoring, round limits, negotiation actions, invalid amounts, deadline behavior, model-output validation, Stripe verification, transaction idempotency, and consumer adapter attribution. Runtime checks exercise the same Durable Object API used by the interface. Source links and inspected dates are retained in `src/shared/catalog.ts`; shoe sizes and live venue/ticket availability remain unverified.
