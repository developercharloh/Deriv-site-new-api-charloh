---
name: Smart Over 2 startup controls
description: Smart Over 2 startup settings and recovery direction requirements for both templates.
---

For both Smart Over 2 templates, configure the entry's Last-X digit lookback once at startup; do not expose or accept it as a trade-condition setting. Keep Virtual Hook enabled by default and keep the editable consecutive-loss limit, defaulting to 2, in the startup settings as well. V1 recovery is Under 5; V2 recovery is Over 4. Persist that direction in startup settings so session resets and older V2 imports cannot fall back to Under.

Use `Over Prediction` for the normal-entry variable in both templates. Name the V1 recovery variable `Under Prediction` and the V2 recovery variable `Recovery Prediction`; preserve the IDs and numeric defaults (2, 5, and 4).

**Why:** The user explicitly corrected this placement after the lookback count was left in the recovery gate. They also reported V2 buying Under 4 and Virtual Hook not engaging despite being checked; temporary workspace metadata and an off-by-default engine state can contradict the visible template setting.

**How to apply:** Keep lookback, hook settings, and contract direction in each template's `trade_definition` Run once at start chain. The recovery gate should read the stored settings and evaluate the entry condition without presenting a lookback or per-cycle direction input. When renaming template variables, keep the template-specific labels above while preserving their IDs and values.