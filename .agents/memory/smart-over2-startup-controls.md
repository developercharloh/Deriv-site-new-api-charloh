---
name: Smart Over 2 startup controls
description: User requirement for where the Last-X entry filter and Virtual Hook options belong in both Smart Over 2 templates.
---

For both Smart Over 2 templates, configure the entry's Last-X digit lookback once at startup; do not expose or accept it as a trade-condition setting. Keep Virtual Hook enabled by default and keep the editable consecutive-loss limit, defaulting to 2, in the startup settings as well.

**Why:** The user explicitly corrected this placement after the lookback count was left in the recovery gate. The count is strategy configuration, not a per-trade condition.

**How to apply:** Keep these controls in the `trade_definition` Run once at start chain in both templates. The recovery gate should read the stored count and evaluate the entry condition without presenting a count input.