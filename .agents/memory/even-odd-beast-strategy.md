---
name: Even Odd Beast parity rule
description: User-corrected entry rule and directional conditions for the Premium Even Odd Beast bot.
---

Even Odd Beast reads the second decimal digit of the candle close and MA9. They must match exactly. An even shared digit permits only the bearish Even setup; an odd shared digit permits only the bullish Odd setup. If conditions qualify for the opposite side, skip the trade. Do not add a NEXUS dependency.

**Why:** The user explicitly corrected the entry rule: matching parity selects the same contract side, and opposite-side conditions must not trigger a trade.

**How to apply:** Preserve this rule in strategy logic, imported Blockly templates, and regression tests; reject mismatches and opposite-side signals.
