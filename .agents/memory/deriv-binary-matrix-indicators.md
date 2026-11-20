---
name: Binary Matrix adaptive market rotation
description: Relative volatility-market ranking, safe switching, and contract confirmation gates
---

Binary Matrix scans all supported volatility indices before choosing one, ranks setups by holdout Wilson lower bound minus the 50% baseline, and holds the strongest relative candidate even when that comparative score is below zero. It keeps scanning competitors and switches only when another eligible setup scores higher. Never switch while a buy is pending or a contract is open; re-evaluate after settlement. Over/Under uses only current MACD histogram direction (12/26/9). Even/Odd also requires the last fully closed one-minute candle: green confirms Even, red confirms Odd. Historical parity samples use the same candle mapping.

**Why:** The user asked the bot to compare all volatility indices, trade only the strongest one, and rotate when another setup overtakes it; the earlier strict evidence threshold left the bot with no contracts. The user also requires MACD only for Over/Under and chose green-candle confirmation for Even and red-candle confirmation for Odd.

**How to apply:** Rank relative evidence without requiring a fixed positive-score cutoff, but preserve active Last-X, indicator/candle, live-payout, fresh-tick, and session-risk protections. Start only after the full supported market scan is complete. Keep one selected market and one contract at a time; don't cancel a live contract to rotate. For Over/Under use MACD only; for parity use the last closed one-minute candle mapping.
