---
name: Even Odd Beast parity rule
description: User-corrected entry rule and directional conditions for the Premium Even Odd Beast bot.
---

Even Odd Beast reads the second decimal digit of the candle close and MA9. An exact digit match is the initial trigger; the indicator setup selects the contract independently of the matched digit's parity (bearish setup → Even, bullish setup → Odd). After the first trigger, keep the selected side latched and re-enter on later broker ticks while that side's setup remains true; do not require another digit match. Pause buys while the selected setup is false, and stop the run at TP/SL. Do not add a NEXUS dependency.

AI Signals is a separate setup scanner: use one-minute candles on Continuous Volatility Indices only. ODD requires a green candle above a rising MA9 and a positive, rising MACD histogram; EVEN requires a red candle below a falling MA9 and a negative, falling histogram. The scanner must not require or present the bot's digit-match trigger. Its handoff supplies the chosen market, setup side, stake, take-profit, stop-loss, and Martingale settings; the bot still waits for its own initial match.

**Why:** The user clarified that setup qualification is independent from the bot's one-time match trigger, and approved the scanner's markets and indicator rules.

**How to apply:** Keep the scanner and bot trigger separate. Preserve the one-time match, setup-based side selection, latched re-entry, setup pause, risk limits, and handoff settings in strategy logic and regression tests.
