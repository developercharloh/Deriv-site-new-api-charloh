---
name: Digit contract availability fallback
description: Alpha Scan behavior when Deriv rejects a digit contract type for the selected synthetic symbol
---

When Deriv rejects a digit proposal or buy because that contract type is unavailable, classify the broker error separately from payout, authorization, and stale-proposal failures. Cache the unsupported route briefly for that symbol, then retry once on the same execution leg with the strongest uncached digit route.

**Why:** A market can support the symbol while rejecting one digit contract family. Treating that response as a generic execution error leaves automatic trading idle, while repeated retries can loop on the same unsupported route.

**How to apply:** Keep momentum direction separate from the purchase contract, preserve the current symbol and risk guards, and allow only one fallback attempt per primary or recovery cycle. Prefer the remaining Over/Under or parity evidence before rescanning.