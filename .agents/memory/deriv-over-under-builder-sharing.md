---
name: Over/Under Builder template sharing
description: Keep signal qualification on the source board; #21 must have no entry-point wait and start buying immediately when Run begins.
---

Bot #21 receives a ready Over/Under source signal and the exact volatility that qualified it. Indicator conditions stay on the source board. The Save & Run action is available as soon as setup conditions and a fresh feed are ready, regardless of the board's 00:02 countdown. After importing XML, rehydrate and verify the full dependent dropdown chain—including both purchase contract choices—before starting. Save & Run starts #21 through DBot's standard Run handler on the connected account; with no entry-point wait, it can buy on the next normal bot cycle and continues until stopped or a saved risk limit is reached.

**Why:** The user confirmed Save & Run should start trading automatically after the signal and risk settings are selected. This can place a contract immediately on the current Demo or Real account. Blockly validates API-backed dropdown values during XML import, before their option lists may be ready; missing purchase selections can generate an empty purchase call when Run starts. The shared XML is also used by the legacy scan-driven Over/Under bot, so keep signal qualification on the source board.

**How to apply:** Apply signal settings only through the `over-under-secret-weapon` load path; keep the shared XML and legacy `over-under-signal` scanner behavior unchanged. Restore and verify market, trade type, duration, and Over/Under purchase choices before auto-starting #21.
