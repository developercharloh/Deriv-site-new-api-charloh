---
name: Over/Under Builder template sharing
description: Keep signal qualification on the source board; #21 must have no entry-point wait and start buying immediately when Run begins.
---

Bot #21 receives a ready Over/Under source signal and the exact volatility that qualified it. Indicator conditions stay on the source board. The Save action is available as soon as setup conditions and a fresh feed are ready, regardless of the board's 00:02 countdown. After importing XML, rehydrate and verify the full dependent dropdown chain—including both purchase contract choices—before returning to DBot Builder. #21 has no entry-point variable or time gate: once the user presses Run, it can buy immediately and continue on normal bot cycles. Stop, take-profit, and stop-loss behavior remain in effect. It loads stopped into standard DBot Builder.

**Why:** Blockly validates API-backed dropdown values during XML import, before their option lists may be ready. Missing purchase selections can generate an empty purchase call when Run starts. The shared XML is also used by the legacy scan-driven Over/Under bot, and repeating source conditions or adding an entry wait in #21 could change when a qualified setup is traded. The user expects a direct purchase after pressing Run.

**How to apply:** Apply signal settings only through the `over-under-secret-weapon` load path; keep the shared XML and legacy `over-under-signal` scanner behavior unchanged. Restore all dependent dropdowns and verify market, trade type, duration, and Over/Under purchase choices before considering #21 ready.
