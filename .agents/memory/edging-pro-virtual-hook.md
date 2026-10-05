---
name: Edging Pro Virtual Hook
description: The loss-streak rule that controls when Edging Pro switches from virtual pairs to real pairs.
---

Advance the Virtual Hook streak only when both legs of a virtual pair lose. With Over 5 and Under 4, both lose on settlement digits 4 or 5. Any mixed result resets the streak, even when the pair's combined profit is negative.

**Why:** the user confirmed that reaching the real-trading threshold requires consecutive pairs where both contracts lose; aggregate pair P/L is not the criterion.

**How to apply:** evaluate the Over and Under outcomes separately when updating the streak. Keep pair P/L for accounting, but do not use it to qualify the threshold.