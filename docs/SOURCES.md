# Demo catalog sources

Inspected **2026-09-28** against each brand’s official page. These are dated catalog snapshots, not live inventory, opening-hours checks, booking availability, or merchant integrations. All bids, campaign budgets, negotiated discounts, and `*-DEMO` codes are fictional. Brands have not authorized these campaigns. The application does not redeem codes or process customer purchases.

## Coffee date

All three $16 two-coffee baskets are **simulated quotes**; no menu price is asserted.

| Brand and source | Facts supported by the inspected page | Limits |
| --- | --- | --- |
| [Blue Bottle — Ferry Building](https://bluebottlecoffee.com/cafes/ferry-building) | Venue page and address: 1 Ferry Building, #7, San Francisco. | The inspected page lists every day as closed. It does not establish whether the café is permanently closed or the hours feed is inaccurate. Availability remains unverified; the catalog explicitly records this. |
| [Sightglass — SoMa](https://sightglasscoffee.com/pages/sightglass-san-francisco-soma) | Flagship at 270 7th Street; roastery, open coffee bar, and an open plan where customers can observe coffee preparation and production. | No quietness, seating, reservation, or immediate availability promise. |
| [Ritual — locations](https://ritualcoffee.com/locations/) | Mission café at 1026 Valencia Street, San Francisco. | No live seating or reservation data. |

## Everyday sneakers

Prices are inspected US dollar product prices before any tax or shipping calculation, frozen for each auction. The listed variants are specific; size availability and delivery are unverified.

| Brand and inspected variant | Price snapshot | Supported material and care facts |
| --- | --- | --- |
| [Allbirds — Women’s Tree Runner Go, Natural White / Rustic Orange (Blizzard Sole)](https://www.allbirds.com/products/womens-tree-runner-go-natural-white-rustic-orange) | **$120**, marked final sale. | TENCEL Lyocell tree-fiber blend upper and cushioned midsole. Shoes are machine washable; remove and hand-wash insoles separately. |
| [Rothy’s — The Ivy Sneaker, ReVelvet Black](https://rothys.com/products/womens-ivy-sneaker-revelvet-black) | **$145**. | ReVelvet knitted upper made from plastic bottles; foam insoles. Remove insoles, machine-wash shoes and insoles with cold water, then air-dry without heat. |
| [Everlane — The Day Sneaker, White](https://www.everlane.com/products/womens-day-sneaker-white) | **$44**, reduced from $148; final sale with no returns or exchanges. | Leather, lace-up styling, slightly tapered toe, and rubber outsole. Professional leather cleaning or spot cleaning. |

Retail pages can render stock states for several sizes at once. This audit confirms the named variant, price, and care facts; it does not establish a purchasable size. Comfort and walking tags are demo personalization inputs grounded in the product positioning, not comparative testing or medical claims.

## San Francisco outings

All three $60 two-person admission amounts are **simulated quotes**. Their equality is a demo choice, not a claim that the institutions charge identical prices. No particular event date or ticket inventory is promised.

| Institution and source | Facts supported by the inspected page | Limits |
| --- | --- | --- |
| [Exploratorium — After Dark](https://www.exploratorium.edu/visit/calendar/after-dark) | Adults 18+, Thursday evenings 6–10 p.m., Pier 15; science, art, and hands-on exhibits. | The page also contains dated programs and separately reserved experiences. The catalog uses the general program description, not a promised event or add-on. |
| [California Academy of Sciences — NightLife](https://www.calacademy.org/nightlife) | Age 21+ with physical photo ID; most Thursdays 6–10 p.m.; science and culture. Planetarium admission is separate. | Some Thursdays have no event; check a specific date. The inspected page lists $26 general NightLife admission and a separate $7 planetarium pass, reinforcing that the application’s $60 basket is a fictional quote. |
| [SFMOMA — visit](https://www.sfmoma.org/visit/) | Modern and contemporary art at 151 Third Street; standard Thursday hours noon–8 p.m. | The inspected page lists $30 adult general admission, but the demo still labels its two-person amount a quote. Exhibitions and live inventory are unverified. |

Age and scheduling facts inform the catalog; this prototype intentionally has no separate eligibility engine. The starting request is fictional and does not establish admission eligibility.

## Consumer apps and hackathon context

[Wavelength’s public site](https://www.heywavelength.com/) describes learning about people through conversations and finding compatible connections. The demo’s Wavelength-inspired conversation, user, match, and request adapter are simulated. There is no Wavelength API connection or partnership. Thread and Roam are fictional demo app surfaces using the same exchange.

The [Startup Speedrun Hackathon page](https://luma.com/g42o84ln) describes an eight-hour event at Cloudflare in San Francisco and an Agentic Payments track covering agents that transact, manage budgets, buy, and sell. Accord’s bidding, user-value selection, advertiser accounting, and publisher settlement demonstrate that track. The supplied tokenized event URL failed retrieval; the canonical public URL above was accessible.

## Research outcome

The nine catalog entries in `src/shared/catalog.ts` match the inspected official pages. The material availability caveat is Blue Bottle’s closed-hours display, which is retained visibly as uncertainty. No unsupported current price, merchant discount, partnership, stock, reservation, or redemption claim should be added to a recommendation.
