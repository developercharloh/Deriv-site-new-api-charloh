---
name: Nexus digit confirmation fixtures
description: Keep deterministic Nexus digit-session browser tests aligned with the live freshness gate.
---

When a deterministic Nexus execution fixture tests a digit contract, make its fresh quotes satisfy the selected Even, Odd, Over, or Under condition. Also preserve the quoted digit at the configured pip precision: with `pip_size` 2, adding 0.02 changes the hundredths digit, while adding 1.00 preserves it.

**Why:** On 2026-10-01, the local browser regression selected a different-market recovery but its generic fresh ticks did not satisfy the recovery digit condition. On 2026-10-02, the same fixture issue appeared during entry confirmation: adding 0.02 changed the last quoted digit and correctly invalidated the selected Over route.

**How to apply:** Match fixture seed and confirmation ticks to the active digit contract; choose increments based on pip precision so each fresh tick remains on that route. Keep the actual fresh-confirmation path enabled and use deterministic local fixtures, never broker live purchases, for regression verification.