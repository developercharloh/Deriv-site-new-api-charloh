---
name: Matches signal historical replay
description: Constraints for validating Matches 0–4 signals against historical market data.
---

Replay the ordered historical tick stream and rebuild the live one-minute candle as each tick arrives. A completed-candle series cannot reproduce the signal's three intraminute TSI updates or its exact two-second entry window. Associate a setup with only the immediately following tick, and report the digit observations without implying trade performance.

**Why:** The live setup depends on intraminute updates; candle-only replay would either miss the flatness/window checks or use future candle data.

**How to apply:** When reviewing this signal historically, use tick timestamps and quotes to rebuild OHLC and TSI in order, then count the next tick digit separately from the trigger count.
