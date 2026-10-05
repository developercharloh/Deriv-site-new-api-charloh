---
name: Edging Pro Virtual Hook
description: The virtual loss-streak rule and broker limitations for Edging Pro's paired live contracts.
---

Advance the Virtual Hook streak only when both legs of a virtual pair lose. With Over 5 and Under 4, both lose on settlement digits 4 or 5. Any mixed result resets the streak, even when the pair's combined profit is negative.

**Why:** the user confirmed that reaching the real-trading threshold requires consecutive pairs where both contracts lose; aggregate pair P/L is not the criterion.

**How to apply:** evaluate the Over and Under outcomes separately when updating the streak. Keep pair P/L for accounting, but do not use it to qualify the threshold.

Deriv buys one proposal per `buy` request; its bulk-purchase endpoint buys the same contract across multiple accounts, not different contract types atomically. The live Over 5 + Under 4 pair is therefore best-effort, not guaranteed to share an entry or settlement tick.

**Why:** the public API exposes separate buys for the two contract types and does not document an atomic mixed-contract purchase.

**How to apply:** send both buys back-to-back after both proposals are ready, but describe them as separate requests and never promise identical entry/exit ticks.