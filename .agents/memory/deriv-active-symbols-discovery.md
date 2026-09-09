---
name: Deriv symbol metadata
description: Durable discovery constraints for public Synthetic Index symbols
---

Deriv's public `active_symbols` catalogue does not always expose the exact phrase “Synthetic Index” in the brief metadata shape, and the legacy public endpoint can return an empty array even while `ticks_history` works. Synthetic instruments may be labeled as Derived, Volatility, Continuous Indices, or by recognizable symbol families.

**Why:** A strict phrase-only filter produced an empty Alpha Scan even though eligible instruments existed; later, the catalogue endpoint itself returned zero records while direct public history remained available.

**How to apply:** Request the full public metadata shape when possible, match documented market labels, retain a conservative verified-symbol fallback, and validate each fallback symbol with live history before showing it. Keep the result descriptive and paper-only.