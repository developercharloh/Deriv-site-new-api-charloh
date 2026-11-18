---
name: Even Odd Beast parity rule
description: User-corrected entry rule and directional conditions for the Premium Even Odd Beast bot.
---

Even Odd Beast reads the second decimal digit of the candle close and MA9. An exact digit match is the initial trigger; the indicator setup selects the contract independently of the matched digit's parity (bearish setup → Even, bullish setup → Odd). After the first trigger, keep the selected side latched and re-enter on later broker ticks while that side's setup remains true; do not require another digit match. Pause buys while the selected setup is false, and stop the run at TP/SL. Do not add a NEXUS dependency.

**Why:** The user clarified that the setup determines the contract side and that the match is a one-time trigger for continuous entries.

**How to apply:** Preserve the one-time match trigger, setup-based side selection, latched re-entry, setup pause, and session risk limits in strategy logic and regression tests.
