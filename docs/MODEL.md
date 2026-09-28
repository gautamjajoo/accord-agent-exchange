# GPT agents in Accord

The live provider is OpenAI's Responses API. `OPENAI_MODEL` defaults to `gpt-5.4-mini` in `wrangler.jsonc`; `OPENAI_API_KEY` is a server secret. No model key reaches the client. Requests use `store: false`, a forced strict function tool, one tool call, and a 1,400-token output ceiling. The provider is implemented in `src/server/agents.ts` without an SDK.

## User agent: assess once, then freeze

Before any bids, `assessFits` sends only the current request, preference tags, and the curated catalog's facts, item names, base prices, and provenance. It never sends campaign strategies, budgets, discount caps, or advertising bids.

The model returns exactly one `assess_fit` call containing one score from 0–100 and a short explanation for each catalog brand. The server rejects missing, duplicate, foreign, or malformed entries and orders the results by the original catalog. The exchange freezes these scores for the entire auction. Changing the request starts a new auction and a new assessment; it does not rescore an auction already in progress. Explicit preferences in the latest request take precedence over conflicting generic scenario tags.

The model assesses preference fit, not financial ranking. Code computes:

```
price_score = 100 × (1 − (base_price − discount) / reference_price)
user_score  = 0.60 × frozen_fit + 0.40 × price_score
```

The reference price is the highest initial catalog price and stays fixed. Cash bids break exact user-score ties; stable brand ID breaks remaining ties. Round feedback is generated from committed scores and prices by the exchange, not another model call.

## Brand agents: isolated policy, shared public board

Each unfinished brand receives one request per round. Its input includes its own catalog item, frozen fit, private strategy, maximum CPC, maximum discount, available budget snapshot, current offer, and own offer history. Competitors' private budgets, strategies, and ceilings are never included. Every bidder sees the same preceding completed round's public offers, leader, scores, and feedback; unfinished submissions are excluded.

The prompt asks the agent to earn the recommendation economically: make a credible opening offer, preserve negotiating room when its strategy warrants it, and make only useful concessions in response to the public board. There is no prescribed winning brand or sequence of offers. The model may submit, hold, finalize, or withdraw. Submissions may also mark themselves final. Higher discounts improve price score; raising CPC alone ordinarily cannot overcome lower user value.

The server binds a response to the requesting brand; the tool schema contains no brand ID, merchant URL, catalog modification, coupon, or payment-execution field. The adapter validates the response shape. The exchange independently enforces frozen campaign ceilings, integer amounts, monotonic revisions, budget constraints, and participation state before committing a round.

## Boundaries and failure behavior

Customer requests, catalog strings, and public explanations are treated as data. Prompts prohibit identity changes, invented facts, and revealing private policy in public explanations. Structural identity and money limits are enforced in code; explanation factuality still depends on model behavior and should be inspected during rehearsal. The demo does not claim production prompt-injection resistance or live inventory validation.

Round calls share the caller's deadline and cancellation signal. A failed model call never switches to simulation. Initial fit failure fails the auction visibly; invalid or late bidding retains the prior valid offer under the runner's rules. Provider error bodies and raw transport errors are not returned to the UI. Completed traces support read-only replay. Explicit simulation is a separate mode with different, labeled decision logic.

`tests/agents.test.ts` covers prompt-data isolation, identity substitutions, invalid outputs, malformed/multiple function calls, private campaign isolation, incomplete rounds, and sanitized failures. Live smoke testing verified both fit assessment and brand decisions; network latency and model decisions remain variable.

## Official references

- [GPT-5.4 mini model and supported endpoints](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- [Responses API function calling and strict tools](https://developers.openai.com/api/docs/guides/function-calling)
