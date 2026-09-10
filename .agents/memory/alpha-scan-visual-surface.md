---
name: Alpha Scan visual surface
description: The Alpha Scan tab opens as a visual-only premium canvas while research/model output stays out of the normal user-facing route.
---

The Alpha Scan opening experience is the neon strategy execution surface: Volatility is followed by stacked Market 1 and Recovery Market rule rows, each reading “If the last X digits are [condition], purchase [market option]” with a buy action below, followed by settings, a journal, and background model status. It omits the screenshot's bottom Home/Journal/Settings/Help navigation and can place validated live contracts through the existing Deriv engine.

**Why:** The user clarified that execution must come from explicit user-selected digit rules; the model only evaluates suitable volatility indices and must not choose the market condition.

**How to apply:** Keep model/data separate from execution, use live ScanRow digits/prices rather than fabricated outcomes, keep independent X=1–8 selectors plus separate trigger-condition and contract-market dropdowns in the stacked Market 1 and Recovery Market rows. Purchase options are Over prediction 0–8, Under prediction 9–1, Even, Odd, Rise, Fall, Matches prediction 0–9, and Differs prediction 0–9. Allow multi-market volatility scanning ON/OFF, require a validated model row and Deriv authorization, and leave the trade journal empty until Deriv confirms a buy. A primary loss evaluates the configured recovery rule and can trigger one recovery selection from the full scanned universe.