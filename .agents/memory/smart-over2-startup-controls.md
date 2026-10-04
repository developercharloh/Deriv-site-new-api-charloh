---
name: Smart Over 2 startup controls
description: Smart Over 2 startup settings, entry rules, and contract routing for V1 through V3.
---

For both Smart Over 2 templates, configure the entry's Last-X digit lookback once at startup; do not expose or accept it as a trade-condition setting. Keep Virtual Hook enabled by default and keep the editable consecutive-loss limit, defaulting to 2, in the startup settings as well. V1 recovery is Under 5; V2 recovery is Over 4. Persist that direction in startup settings so session resets and older V2 imports cannot fall back to Under.

Use `Over Prediction` for the normal-entry variable in both templates. Name the V1 recovery variable `Under Prediction` and the V2 recovery variable `Recovery Prediction`; preserve the IDs and numeric defaults (2, 5, and 4).

V3 is a separate Over-only strategy. Its startup settings let users choose Last X Digits (default 4) and Over Prediction (default 2); every selected digit must be in the inclusive range 3–6. The same Over Prediction controls Virtual Hook outcomes and live purchases. Virtual Hook starts enabled with a two-consecutive-virtual-loss threshold. V3 has no Under or recovery-prediction branch; do not change V1 or V2 while maintaining it.

**Why:** The user explicitly corrected this placement after the lookback count was left in the recovery gate. They also reported V2 buying Under 4 and Virtual Hook not engaging despite being checked; temporary workspace metadata and an off-by-default engine state can contradict the visible template setting. The user chose to make both V3 startup values control trades while preserving its 3–6 gate and Virtual Hook.

**How to apply:** Keep hook settings in each template's `trade_definition` Run once at start chain. V1/V2 recovery gates must keep their own persisted directions. V3's Last X count controls the 3–6 entry window, and its Over Prediction must remain consistent across Virtual Hook results, proposals, purchases, and Journal status.