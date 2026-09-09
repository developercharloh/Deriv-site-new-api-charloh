---
name: Deriv symbol metadata
description: Durable discovery constraints for public Synthetic Index symbols
---

Deriv's public `active_symbols` catalogue does not always expose the exact phrase “Synthetic Index” in the brief metadata shape. Synthetic instruments may be labeled as Derived, Volatility, Continuous Indices, or by recognizable symbol families.

**Why:** A strict phrase-only filter produced an empty Alpha Scan even though the public catalogue contained eligible instruments.

**How to apply:** Request the full public metadata shape when possible, match the documented market labels, and retain a conservative symbol-family fallback. Keep the result descriptive and paper-only.