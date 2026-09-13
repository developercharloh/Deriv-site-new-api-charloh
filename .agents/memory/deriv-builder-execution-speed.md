---
name: Builder execution speed
description: The DBot Builder FAST mode contract lifecycle and its settlement requirement.
---

FAST buys once per broker tick with one active contract. A settlement received on a later broker tick can re-arm FAST on that same settlement tick; same-tick settlement still waits for the next tick. SLOW waits for the next subscribed broker tick. Both modes avoid wall-clock delays and tick-history polling in the loop. Generated result checks use the last settled contract, so every loss updates the next stake and every win restores the initial stake.

**Why:** Overlapping contracts committed the next stake before a late loss was known, causing Martingale to skip a loss. Settlement-first re-entry preserves FAST responsiveness without allowing an open-contract overlap.

**How to apply:** Keep one active contract lease in every mode and one purchase per broker tick. Record the purchase tick on the lease; permit FAST re-arm only when settlement arrived on a later tick, and keep same-tick settlement blocked. Keep the last settled contract separate from the current open contract, default the first result check to the initial-stake path, and apply Martingale only after settlement updates that stored result.