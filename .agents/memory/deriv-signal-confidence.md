---
name: Signal confidence semantics
description: How Rise/Fall bot confidence is calculated and used
---

Signal confidence measures the percentage of recent tick-to-tick movements that agree with the current predicted CALL/Rise or PUT/Fall direction. The master bot defaults to a 60-tick window, with the window exposed as a workspace variable.

**Why:** This gives the user a transparent, market-specific strength reading without silently changing the existing ADX, RSI, and MACD purchase gate.

**How to apply:** Keep confidence in the journal unless the user explicitly asks for it to become a purchase gate. Treat the configured count as the number of directional comparisons evaluated by the existing tick-percentage utility.