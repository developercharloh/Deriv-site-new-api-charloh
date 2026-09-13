---
name: FAST slot state preservation
description: The state invariant that keeps clock-paced FAST purchases distinct across generated cycle restarts
---

Every Redux transition that ends or restarts a FAST trade cycle must preserve the monotonic FAST slot counter. A settlement can pass through a terminal `SELL` state before the next `FAST_REARM`; dropping the counter causes the next clock release to reuse the previous signal key and the shared contract gate correctly rejects it as a duplicate.

**Why:** A generated Binary Matrix loop appeared to remain running after its first successful contract, but the second purchase was rejected because the terminal transition reset the slot identity.

**How to apply:** When adding or changing trade-cycle reducer transitions, carry forward the slot counter unless the entire bot session is intentionally reset. Keep the generated FAST integration regression at three consecutive purchases with settlement and Martingale assertions.