# Three live brand-agent terminals

Open three terminals in `/Users/gautamjajoo/Documents/ChatGPT/AI Ad Network`. Use Node.js 24 or newer:

```sh
node scripts/watch-agent.mjs --brand blue-bottle
```

```sh
node scripts/watch-agent.mjs --brand sightglass
```

```sh
node scripts/watch-agent.mjs --brand ritual
```

All three subscribe to the deployed exchange and the shared presentation workspace `ef5d07d4-fc2a-41d9-b0bc-e1869dfb8e7c`. Start a coffee auction in the consumer demo using that workspace. Each terminal automatically follows new relevant auctions and prints its brand’s actual recorded model requests/responses alongside exchange events. Initial connection replays the newest matching auction’s existing trace; these are timestamped records, not newly dispatched model calls.

If `node --version` is older than 24, replace `node` in the commands with:

```sh
/Users/gautamjajoo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
```

## What actually runs where

The Worker’s Durable Object coordinates each auction. Brand model requests execute on the server, using the configured provider. The CLI is a **read-only subscriber**, polling once per second; it is not the brand model process itself. Closing a terminal does not stop negotiation. The CLI authenticates with the operator token described below; it never performs bids, accepts winners, or charges advertisers.

- `model.request`: server-recorded outbound provider request, with an allowlisted public payload projection.
- `model.response`: actual provider response fields; **provisional** until accepted by the exchange.
- `model.error`: recorded request failure, timeout, or invalid response.
- `round.started` / `round.committed`: exchange records for the negotiation round and accepted offers.
- Auction and placement events: recorded execution milestones, when instrumented by the server.

Private campaign limits, authorization headers, instructions, cookies, and arbitrary raw objects are omitted. The CLI adds a second allowlist to the server’s trace redaction. Displayed JSON therefore does not claim to be the complete raw HTTP request. The auction header identifies live or simulated agents; simulation is never labeled as a real provider request. Older auctions without traces explicitly show that instrumentation is unavailable.

## Options and verification

```sh
# One snapshot, all agents; exit instead of following.
node scripts/watch-agent.mjs --all --once

# Follow a specific auction, retaining the same workspace.
node scripts/watch-agent.mjs --brand sightglass --auction AUCTION_UUID

# Observe a local exchange and an explicitly selected workspace.
node scripts/watch-agent.mjs --all --url http://127.0.0.1:8787 --workspace WORKSPACE_UUID
```

`--brand` and `--all` are mutually exclusive; omitting both selects all agents. `--auction` pins one auction instead of following new arrivals. The server must recognize the chosen presentation workspace. A private unrelated workspace is not made accessible by this script. Network failures are shown as subscriber errors, then retried; no fake events are substituted. Press Ctrl+C to exit.

## Operator authentication

The deployed trace API requires operator access. The subscriber reads `ACCORD_OPERATOR_TOKEN` (or `ADMIN_TOKEN`) from its environment. For this project’s default deployment only, it can use the `ADMIN_TOKEN` entry in the ignored local `.dev.vars` file. It sends only that operator token, never model or Stripe credentials. On another computer, configure `ACCORD_OPERATOR_TOKEN` before running it. Never put the token in a URL.
