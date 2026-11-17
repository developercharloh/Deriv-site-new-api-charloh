---
name: Over/Under Builder template sharing
description: Keep signal qualification on the source board and configure #21 only for its selected market, contract, risk, and entry time.
---

Bot #21 receives a ready Over/Under source signal and the exact volatility that qualified it. Indicator conditions stay on the source board; the bot only receives the selected direction/barrier, saved risk values, and the 00:02-before-close entry gate for one-minute candles. It loads stopped into standard DBot Builder for the user to start from Run.

**Why:** The shared XML is also used by the legacy scan-driven Over/Under bot, and repeating source conditions in #21 could change or contradict which signal gets traded.

**How to apply:** Apply these values only through the `over-under-secret-weapon` load path; keep the shared XML and the legacy `over-under-signal` scanner behavior unchanged.
