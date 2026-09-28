# Deployed external-agent verification

Verified September 28, 2026 at 23:16 UTC against the deployed Accord exchange, version `83df6f28-a6b3-46c5-93c9-9ce872d301fe`.

This was a controlled integration test using our own **Accord External Pilot** process and an explicitly fictional catalog. It demonstrates that an independent process can participate; it is not evidence of a third-party merchant relationship.

## Observed live path

1. The operator registered a new catalog entry and received a brand-scoped invitation. The campaign started inactive with zero funds.
2. The test funded its separate **simulation** account and activated it. Creating a Stripe sandbox funding Checkout for the new brand also succeeded; that Checkout was not paid in this test.
3. The standalone `scripts/external-brand-agent.mjs` ran in normal `live_gpt` mode, called GPT with its own process environment, and polled the deployed opportunity API. It did not use `--rules`.
4. Auction `d4b3cfae-725e-4a8c-b942-518c26238e6b` included Blue Bottle, Sightglass, Ritual, and the external test brand.
5. The external model chose **1¢ CPC, $1.40 discount, final=true**. Its POST was acknowledged at `23:16:21 UTC` and committed when round one closed. Its frozen fit score was 42/100. It received no later turns after finalizing.
6. The auction completed after three rounds with reason `all_final`. Ritual won at **95¢ CPC and $2.10 discount**, versus Blue Bottle's $1.20 CPC. The external test brand lost under the same scoring policy as the other participants.
7. The dating consumer API returned HTTP 200 for the same auction, preserving attribution and excluding private bidder state.
8. The external credential received HTTP 401 when attempting the operator ledger. After revocation, its own status endpoint also returned HTTP 401.

The live external-agent test used **simulated advertising funds**. Separate [Stripe verification](STRIPE-VERIFICATION.md) documents completed sandbox charges and transfers for the existing publisher integrations. Do not combine those two observations into a claim that this external test brand paid a completed Stripe transfer.

## Reproduce

Follow [external-agent setup](EXTERNAL-AGENTS.md). Register a new invitation in the consumer integration workspace, fund the campaign in the intended payment mode, activate it, and start the client before creating a fresh consumer request. Never reuse the revoked test invitation. A real merchant should supply its own reviewed catalog and run its own client; no merchant model key belongs in the operator console.

The offer and winner above are historical observations. Neither is hardcoded or guaranteed on another run.
