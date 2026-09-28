# Accord — 90-second recording script

Open the deployed dating app and the signed-in exchange in separate tabs. Refresh both. Use a **new conversation/request** so the network trace contains current execution events. Do not show credentials. Keep Stripe test mode visible.

Dating: https://accord-dating-demo.kairosity-main-website.workers.dev/

Exchange: https://accord-agent-exchange.kairosity-main-website.workers.dev/?workspace=ef5d07d4-fc2a-41d9-b0bc-e1869dfb8e7c

| Time | Screen/action | Say |
|---|---|---|
| 0–12s | Dating chat; start a new conversation and request a coffee spot. | “AI apps increasingly decide what people buy. Accord is the exchange where brands compete to give those users a better deal.” |
| 12–25s | Switch to Exchange immediately. Show incoming intent and three agent terminals. | “This dating assistant sends a real request to our deployed exchange. Blue Bottle, Sightglass, and Ritual each have an independent brand agent.” |
| 25–42s | Stay on Agent terminals while rounds advance. | “Each agent offers two things: a payment to the app and a discount to the customer. They see the completed round, then decide whether to improve, hold, finalize, or withdraw. Negotiation stops within five rounds.” |
| 42–53s | Click Network trace; expand a request or response. | “These are persisted server events, with actual model requests, responses, timing, and validated offers. The exchange coordinates the auction and keeps the audit trail.” |
| 53–67s | Return to Agent terminals; scroll to offer board and winner comparison. | “The user agent scores personal fit and price after discount. The highest advertising bid does not automatically win. A brand can pay less for the click and still win by giving the user more value.” |
| 67–80s | Return to dating app, show selected offer/code, click its merchant button. Switch back to exchange receipt. | “The winning offer comes back to the app. Only the first click charges the advertiser. Eighty percent goes to the publisher; twenty percent is Accord’s network revenue.” |
| 80–90s | Show receipt, then briefly the shopping/outings tabs if ready. | “The same exchange supports dating, shopping, and outings. This run uses example campaigns and Stripe test money. We’re building the transaction infrastructure for agent-mediated commerce.” |

Read actual winning names and amounts from the screen. Do not promise a lower-bid winner before the auction completes. If this run's highest cash bidder also wins, say “Cash only breaks exact user-score ties” and explain the mechanism; do not claim a lead change that did not happen.

If negotiation finishes while you talk, the terminal history and Network trace remain inspectable. A historical replay must be described as a recorded run. Click within ten minutes of selection to avoid reservation expiry. Wait for the receipt to show transfer completion before saying it settled; otherwise say settlement is pending.

Tagline: **The agent exchange where brands compete to give AI users better deals.**
