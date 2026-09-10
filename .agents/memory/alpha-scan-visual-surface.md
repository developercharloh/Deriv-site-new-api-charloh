---
name: Alpha Scan visual surface
description: The Alpha Scan tab opens as a visual-only premium canvas while research/model output stays out of the normal user-facing route.
---

The Alpha Scan opening experience is the neon strategy execution surface: separate Market 1/Market 2 digit-rule rows, volatility scanning controls, a journal, and background model status. It omits the screenshot's bottom Home/Journal/Settings/Help navigation and can place validated live contracts through the existing Deriv engine.

**Why:** The user clarified that execution must come from explicit user-selected digit rules; the model only evaluates suitable volatility indices and must not choose the market condition.

**How to apply:** Keep model/data separate from execution, use live ScanRow digits/prices rather than fabricated outcomes, give Market 1 and Market 2 independent X=1–8 selectors and explicit market dropdowns, allow multi-market volatility scanning ON/OFF, require a validated model row and Deriv authorization, and leave the trade journal empty until Deriv confirms a buy. A primary loss evaluates the configured recovery rule and can trigger one recovery selection from the full scanned universe.