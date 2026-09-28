# Accord interface

Design reference: https://primitivelabs.ai/instinct, inspected September 28, 2026.

The reference uses Oceanic Text TRIAL for large serif typography, STK Bureau Sans for UI, and PP Supply Mono for technical labels. This implementation uses freely hosted Google Fonts approximations: Instrument Serif, DM Sans, and IBM Plex Mono. It does not copy or redistribute their proprietary font files.

The adapted visual language is paper (#fbfaf9 / #f5f3f1), ink (#111111), coral (#ff6d47), blue (#97bfe7), and sand (#f6d197), with square bordered technical panels and a restrained sticky translucent navigation. A serif heading enters from the left, supporting text rises, cards reveal with a stagger, and the intent-to-accord signal line animates. All motion is disabled under prefers-reduced-motion. Controls support focus-visible outlines; small explanatory text uses a darker neutral to remain legible.

The exchange is the main product surface. Unlike the marketing-page reference, a large photographic hero is omitted so the auction remains reachable in the first viewport. Responsive layouts stack the three agent cards and keep consumer request input ahead of the exchange on smaller screens.

The two mode selectors are intentionally independent: GPT versus rule-based decisions, and simulated funds versus Stripe sandbox funds. Simulated funds default even when sandbox credentials are present. Completed-auction history is read-only; the bundled real GPT recording is labeled by source and date.

## State-driven motion pass

Consulted Motion's official AnimatePresence and useReducedMotion documentation, Framer Academy's scroll-variant guidance, Watermelon UI's component/dashboard catalog, and 21st.dev's timeline/progress/number examples. The shipped components are custom to Accord rather than copied third-party blocks.

- https://motion.dev/docs/react-animate-presence
- https://motion.dev/docs/react-use-reduced-motion
- https://motion.dev/docs/react-layout-animations
- https://www.framer.com/academy/lessons/scroll-animations
- https://ui.watermelon.sh/
- https://21st.dev/community/components

`AuctionMotion.tsx` animates committed numeric replacements rather than tweening invented prices. `RoundStage` distinguishes fit assessment, preparation, actual sealed bidding (requires the server's round_started_at), pause, completion, cancellation and replay. The countdown uses the server deadline. Its five segments count committed rounds, not model progress. Lead-change ribbons compare two actual completed rounds. The common leader marker moves only when the public leader changes. Brand lanes stay in fixed order.

Incoming requests animate once per auction ID. The headline becomes compact once an auction is present so the actual exchange receives more screen space. MotionConfig and useReducedMotion respect system preferences. Settings modal supports Escape, keyboard focus containment, initial focus, and focus restoration.
