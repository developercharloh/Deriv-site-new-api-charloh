---
name: Alpha Scan cockpit regression surface
description: Durable browser-regression constraints for replacing the Alpha Scan UI
---

When replacing the Alpha Scan presentation, preserve the browser-visible state markers for the model pick, model status, scan coverage, open journal contract, and execution controls. The regression uses these markers to validate the real settled flow, not just the initial render.

**Why:** The cockpit can look correct while silently removing the DOM evidence used to verify full market coverage, model selection, payout gating, duplicate-purchase protection, settlement rescans, and risk boundaries.

**How to apply:** Keep the established `data-testid` and `data-symbol` markers on the new surface, render the complete discovered universe in the coverage surface, and make fixture assertions compare covered markets with the discovered count rather than a hard-coded symbol count.