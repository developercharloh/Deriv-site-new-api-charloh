---
name: Over/Under Builder template sharing
description: Keep signal qualification on the source board; #21's first 00:02 window arms continuous purchases on its normal cycles.
---

Bot #21 receives a ready Over/Under source signal and the exact volatility that qualified it. Indicator conditions stay on the source board. The first 00:02-before-close window on a one-minute candle arms trading; later purchases continue on normal bot cycles without waiting for another window. Stop, take-profit, and stop-loss behavior remain in effect. It loads stopped into standard DBot Builder for the user to start from Run.

**Why:** The shared XML is also used by the legacy scan-driven Over/Under bot, and repeating source conditions in #21 could change which signal gets traded. The user expects 00:02 to be the initial entry trigger, not a per-contract schedule.

**How to apply:** Apply these values only through the `over-under-secret-weapon` load path; keep the shared XML and the legacy `over-under-signal` scanner behavior unchanged.
