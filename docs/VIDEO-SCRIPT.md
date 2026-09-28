# Accord video demo — 78 seconds

## Provenance and presentation

This edit presents **a recorded live GPT run**, with motion graphics built from its actual committed offers and accounting records. It is not a new auction running while the video plays. Keep **“Recorded live GPT run · Stripe sandbox”** visible on auction and payment scenes. Any animated reconstruction of the interface should be labeled **“Recorded run · animated visualization”** rather than screen recording.

Evidence: `test-results/dating-consumer-sandbox.json`, auction `2d9975c9-16d0-4e0b-b428-40744f47c5cc`, recorded September 28, 2026 at 21:01 UTC. Fictional campaigns, demo basket prices, and illustrative discount codes; actual GPT decisions and Stripe sandbox transfer.

## Storyboard and narration

| Time | Picture and motion | Narration |
|---|---|---|
| 00–07 | Ivory title, coral underline, Accord wordmark. **Brands compete on your terms.** | “What if brands competed to give you a better deal? This is Accord.” |
| 07–16 | Actual consumer screenshot and coffee request. Request line travels toward exchange. | “Two people match and ask for coffee. Their app sends a recommendation request to our exchange.” |
| 16–23 | Four deployed service nodes, then three frozen fit scores. **Fit before bids.** | “The user agent assesses personal fit before seeing bids. That score stays fixed.” |
| 23–43 | Three stable brand columns; five actual rounds, four seconds each. Animate committed prices and leader marker only. **CPC bid + customer discount.** | “Brand agents offer payment for the click, plus a customer discount. They respond to the previous round, for up to five rounds. Here, the lead changes every round. Selection combines sixty percent fit and forty percent effective price.” |
| 43–52 | Blue Bottle **$1.80 CPC / $2 off** versus Ritual **90¢ CPC / $4.50 off**. Ritual winner. Exact user scores available below. | “Blue Bottle bids a dollar eighty. Ritual bids ninety cents, gives four fifty off, and wins on user value.” |
| 52–60 | Winner travels back to conversation: **$16 → $11.50**, `RITUAL-DEMO`. | “The negotiated offer returns to the dating app, with its eleven-fifty demo price and discount code.” |
| 60–70 | Recorded receipt, 90¢ splits into **72¢ publisher / 18¢ network**. Completed sandbox transfer reference. | “The first click charges ninety cents: seventy-two to the publisher, eighteen to Accord. The Stripe sandbox transfer is verified.” |
| 70–78 | Wavelength, Thread, Roam linked to Accord. **Three apps. Nine agents. One exchange.** | “Three consumer apps. Nine brand agents. One exchange for personalized negotiation and transactions.” |

This is the final agreed renderer timeline: **78 seconds at 24 fps**. Narration is approximately 180 words. Render each scene's speech separately and align it with the scene start; do not stretch speech to fill deliberate pauses. Use on-screen captions so the video works muted.

### Machine-readable narration timing

```json
[
  {"start":0,"end":7,"text":"What if brands competed to give you a better deal? This is Accord."},
  {"start":7,"end":16,"text":"Two people match and ask for coffee. Their app sends a recommendation request to our exchange."},
  {"start":16,"end":23,"text":"The user agent assesses personal fit before seeing bids. That score stays fixed."},
  {"start":23,"end":43,"text":"Brand agents offer payment for the click, plus a customer discount. They respond to the previous round, for up to five rounds. Here, the lead changes every round. Selection combines sixty percent fit and forty percent effective price."},
  {"start":43,"end":52,"text":"Blue Bottle bids a dollar eighty. Ritual bids ninety cents, gives four fifty off, and wins on user value."},
  {"start":52,"end":60,"text":"The negotiated offer returns to the dating app, with its eleven-fifty demo price and discount code."},
  {"start":60,"end":70,"text":"The first click charges ninety cents: seventy-two to the publisher, eighteen to Accord. The Stripe sandbox transfer is verified."},
  {"start":70,"end":78,"text":"Three consumer apps. Nine brand agents. One exchange for personalized negotiation and transactions."}
]
```

## Exact values for the animated round sequence

All figures below come directly from the stored live result. Each cell is **CPC / discount / user score**. Base basket prices are $16 for all three brands; the fit scores remain Blue Bottle 84, Sightglass 79, Ritual 82.

| Round | Blue Bottle | Sightglass | Ritual | Leader |
|---|---|---|---|---|
| 1 | $1.80 / $0.00 / 50.400 | $0.90 / $2.20 / 52.900 | $0.85 / $1.20 / 52.200 | Sightglass |
| 2 | $1.80 / $2.00 / 55.400 | $0.90 / $2.60 / 53.900 | $0.90 / $2.21 / 54.725 | Blue Bottle |
| 3 | $1.80 / $2.00 / 55.400 | $0.90 / $3.60 / 56.400 | $0.90 / $3.50 / 57.950 | Ritual |
| 4 | $1.80 / $2.00 / 55.400 | $0.90 / $5.20 / 60.400 | $0.90 / $3.50 / 57.950 | Sightglass |
| 5 | $1.80 / $2.00 / 55.400 | $0.90 / $5.21 / 60.425 | $0.90 / $4.50 / 60.450 | Ritual |

Round 4 included a rejected Blue Bottle discount that exceeded its campaign limit. Its prior valid offer stayed in place. If action logs are visible, preserve that rejection rather than depicting an accepted revision. All three submitted final offers in round 5; termination reason was `all_final`, not `target_reached`.

Final effective prices: Blue Bottle **$14.00**, Sightglass **$10.79**, Ritual **$11.50**. Ritual does not have the largest discount or lowest price. It wins on the combined user score, by **0.025** points over Sightglass. Do not round both to a displayed tie without preserving the explicit winner or showing three decimals.

Recorded payment: click `click:ffe20b6e-49a0-4f40-a589-6bf7021c3568`; completed sandbox transfer `tr_3UKlbYAXV45EOxtS2U9yb5LB`, **72 cents**, `livemode: false`. The 18-cent network figure is gross before processing fees. The discount code is illustrative and no cashback payment occurs.

## Export and style

- 1920×1080, 24 fps, H.264 MP4; 78 seconds. Keep a still poster and captions beside the video.
- Match the product's warm ivory, near-black type, coral accent, editorial serif display headings, and compact monospace transaction labels.
- Use purposeful motion: request handoff, committed offer updates, leader movement, winner return, accounting split. Avoid decorative particle backgrounds or unrelated stock footage.
- Use soft eased transitions of 250–500 ms; add brief holds for numbers and the final receipt. Keep essential content within a 5% safe margin.
- Opening and closing should not imply merchant endorsement or a production merchant integration. The persistent demo/sandbox label is part of the presentation.
