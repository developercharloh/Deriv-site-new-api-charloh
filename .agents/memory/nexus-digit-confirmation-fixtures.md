---
name: Nexus digit confirmation fixtures
description: Keep deterministic Nexus digit-session browser tests aligned with the live freshness gate.
---

When a deterministic Nexus execution fixture tests a digit contract, explicitly set every fresh quote's last digit to the selected Even, Odd, Over, or Under route. With `pip_size` 2, adding 0.02 changes the hundredths digit, while adding 1.00 preserves it—including a deliberately mismatching digit, which would keep every later tick off-route.

**Why:** A mismatch-then-match regression stalled on 2026-10-02 because its follow-up quotes added 1.00 to the mismatching quote, so the route digit never changed and confirmation correctly remained below 3/3.

**How to apply:** Build quotes from a moving integer component plus the explicit route digit divided by 100. Keep the actual fresh-confirmation path enabled and use deterministic local fixtures, never broker live purchases, for regression verification.