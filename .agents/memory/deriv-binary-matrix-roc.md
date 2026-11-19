---
name: Binary Matrix ROC scope
description: How momentum confirmation should interact with Binary Matrix digit contracts
---

The adaptive Binary Matrix runner uses a configurable Rate of Change lookback (five ticks by default). ROC direction can confirm Over/Under entries, but must not be mapped to Even/Odd because price direction does not predict digit parity. Historical evaluation and live entry checks must use the same directional confirmation, and a live purchase still needs a fresh matching tick after its payout proposal passes.

**Why:** The user approved ROC as an added momentum indicator while preserving the existing digit-rule mapping and no-trade safety gates.

**How to apply:** Keep parity rules independent of momentum direction. For Over/Under, require rising/falling ROC to match the direction, and validate that filtered entry set on chronological holdout results before trading.
