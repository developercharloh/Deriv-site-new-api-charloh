---
name: Binary Matrix MACD-only confirmation
description: How price indicators qualify Binary Matrix digit contracts
---

Binary Matrix qualifies each existing rule from its own historical evidence, then locks the selected market and rule before the latest Last-X pattern appears. It waits for that exact configured pattern, checks live payout after the pattern and indicator conditions appear, and buys only on a later fresh matching tick. Over/Under uses only current MACD histogram direction (12/26/9); Even/Odd remains governed only by digit rules.

**Why:** The user clarified that Binary Matrix must use MACD only because RSI suppresses signals; preserve the existing digit rules and exclude ROC.

**How to apply:** Keep historical and live rules aligned. For Over/Under, use only MACD histogram above zero for bullish and below zero for bearish. Once selected, do not switch the locked market or contract direction while waiting for its Last-X pattern. Check payout only after the Last-X pattern and MACD align; then require a later fresh tick before buying. Do not apply price direction to parity contracts or add candle-color conditions unless the Binary Matrix strategy itself introduces them.
