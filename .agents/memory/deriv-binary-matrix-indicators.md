---
name: Binary Matrix MACD and candle gates
description: MACD direction for Over/Under and closed-candle confirmation for parity
---

Binary Matrix qualifies each existing rule from its own historical evidence, then locks the selected market and rule before the latest Last-X pattern appears. It waits for that exact configured pattern, checks live payout after the pattern and confirmation conditions appear, and buys only on a later fresh matching tick. Over/Under uses only current MACD histogram direction (12/26/9). Even/Odd also requires the last fully closed one-minute candle: green confirms Even, red confirms Odd. Historical parity samples use the same candle mapping.

**Why:** The user requires MACD only for Over/Under, explicitly chose green-candle confirmation for Even and red-candle confirmation for Odd, and asked that the other entry gates remain.

**How to apply:** Keep historical and live rules aligned. For Over/Under, use only MACD histogram above zero for bullish and below zero for bearish. For parity, use only the last completed one-minute candle color as the extra confirmation: green for Even, red for Odd; do not apply MACD to parity. Once selected, preserve the locked market and contract direction while waiting for Last-X and the needed confirmation. Check payout after those conditions align, then require a later fresh tick before buying.
