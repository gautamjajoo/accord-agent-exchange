# Accord

## Elevator pitch

The agent exchange where brands compete to give AI users better deals.

## Inspiration

AI assistants are becoming the place where people decide what to buy, where to go, and what to do next. But bringing traditional advertising into that conversation risks optimizing recommendations for whoever pays the most.

We started with a simple question: what if brands had to compete on what they give the user, too? A dating assistant helping two people choose a coffee spot became our starting point. The opportunity is much larger: a transaction layer connecting consumer AI apps with brands that can negotiate useful, personalized offers.

## What it does

Accord is an exchange where brand agents submit two amounts: an advertising bid and a customer discount. A user agent assesses personal fit before bidding begins. The exchange then scores offers on that frozen fit and the effective price after discount.

Brands can revise, hold, finalize, or withdraw over a maximum of five rounds. A brand can lose the cash auction and still earn the recommendation by offering better user value. Cash breaks exact score ties; it does not buy a higher personalization score.

The selected offer returns to the consumer app. Its first click charges the advertiser, credits 80% to the publisher, and records 20% as network revenue. Our deployed integrations cover dating, shopping, and San Francisco outings, with nine brand-agent templates. Current campaigns and discount codes are illustrative, and payments use Stripe test mode.

## How we built it

We built four separately deployed Cloudflare Workers: one exchange and three consumer apps. React, TypeScript, Vite, and Motion power the interfaces. A SQLite-backed Durable Object persists auction state, reservations, accounting, and settlement jobs. GPT agents use the OpenAI API for fit assessment and structured bidding decisions. Stripe Checkout and Connect handle sandbox funding and publisher transfers.

The operator console exposes three brand-agent terminal views and an inspectable network trace. Those views display actual persisted execution events, including model response timing, validated offers, completed rounds, and settlement status. Signed operator sessions and separate publisher credentials keep campaign controls and private bidding policies out of publisher responses.

## Challenges we faced

The hardest work was coordinating independent agents while keeping the auction fair and the accounting correct. Every agent in a round must see the same completed information; late or invalid responses cannot rewrite committed offers. Browser refreshes must not restart negotiation, and repeated clicks or settlement retries must not create duplicate charges.

We also had to make the system understandable. Separating personal fit, customer price, and advertising payment lets an operator see why an offer won instead of trusting an opaque recommendation.

## What we learned

The useful agentic behavior comes from the negotiation contract. Adding customer discounts to bids gives agents a meaningful way to compete for user value. Model flexibility works best inside explicit constraints: fixed scoring, campaign limits, simultaneous rounds, durable state, and auditable money movement.

## What we're proud of

We deployed the complete request-to-recommendation flow, verified live GPT negotiations, demonstrated lower-cash-bid winners, and completed Stripe sandbox publisher transfers. Our automated suite has 231 passing tests covering negotiation, isolation, failure recovery, and accounting behavior.

## What's next

Our next step is onboarding real publishers and merchant partners, validating the commercial model, and replacing illustrative offers with merchant-authorized promotions. Public production onboarding also needs individual accounts, broader operational hardening, abuse controls, and live-payment readiness. Accord's core is the exchange: personalization, negotiation, attribution, and settlement shared across consumer AI applications.

## Built with

TypeScript, React, Vite, Cloudflare Workers, Durable Objects, SQLite, OpenAI API, GPT, Stripe, Stripe Connect, Motion, Vitest, CSS

## Links

- Source: https://github.com/gautamjajoo/accord-agent-exchange
- Exchange: https://accord-agent-exchange.kairosity-main-website.workers.dev/
- Dating: https://accord-dating-demo.kairosity-main-website.workers.dev/
- Shopping: https://accord-shopping-demo.kairosity-main-website.workers.dev/
- Outings: https://accord-outings-demo.kairosity-main-website.workers.dev/
