---
name: Matches King digit selection
description: The expected selector and per-leg result behavior for Matches King.
---

Matches King must let the user choose how many digits to match and display one separate prediction box for each selected digit. Each digit is its own Digit Match contract: when the settled digit is 7 in a 4, 5, 9, 7 batch, the 7 leg wins and the other three legs lose.

**Why:** The user corrected the initial comma-separated digit field and explicitly required separate, count-controlled inputs.

**How to apply:** Keep the count selector, visible per-digit boxes, and individual leg outcomes aligned whenever Matches King settings or settlement logic change.

Matches King must offer “Use Virtual Hook” as true/false, default true. False means real contracts are bought without waiting for the virtual hook.

**Why:** The user explicitly requested an optional hook, not a permanently required virtual-loss gate.

**How to apply:** Preserve true for older saved bots without an explicit choice; bypass only the virtual gate when false, not risk limits or Stop.
