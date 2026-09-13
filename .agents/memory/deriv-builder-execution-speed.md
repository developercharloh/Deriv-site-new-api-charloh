---
name: Builder execution speed
description: The DBot Builder FAST mode contract lifecycle and its settlement requirement.
---

FAST re-enters immediately once the authoritative settlement is received; SLOW waits for the next subscribed broker tick. Both modes avoid wall-clock delays and tick-history polling in the loop. Generated result checks use the last settled contract, so every loss updates the next stake and every win restores the initial stake.

**Why:** Overlapping contracts committed the next stake before a late loss was known, causing Martingale to skip a loss. Settlement-first re-entry preserves FAST responsiveness without allowing an open-contract overlap.

**How to apply:** Keep one active contract lease in every mode. After FAST settlement, permit exactly one same-tick re-entry token; after SLOW settlement, re-arm on the next broker tick. Keep the last settled contract separate from the current open contract, default the first result check to the initial-stake path, and apply Martingale only after settlement updates that stored result.