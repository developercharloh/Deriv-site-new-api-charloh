---
name: Builder execution speed
description: The DBot Builder FAST mode contract lifecycle and its settlement requirement.
---

FAST re-arms immediately from the authoritative settlement event with one active contract. A one-shot same-tick token prevents the engine loop from buying twice before the next settlement. SLOW waits for the next subscribed broker tick. Both modes avoid wall-clock delays and tick-history polling in the loop. Generated result checks use the last settled contract, so every loss updates the next stake and every win restores the initial stake.

**Why:** Overlapping contracts committed the next stake before a late loss was known, causing Martingale to skip a loss. Settlement-first re-entry preserves FAST responsiveness without allowing an open-contract overlap.

**How to apply:** Keep one active contract lease in every mode. On authoritative FAST settlement, update totals and the last-settled contract before granting exactly one re-entry token; consume that token before acquisition and never allow overlap. Keep the last settled contract separate from the current open contract, default the first result check to the initial-stake path, and apply Martingale only after settlement updates that stored result.