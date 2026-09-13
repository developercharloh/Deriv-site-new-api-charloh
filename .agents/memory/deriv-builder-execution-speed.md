---
name: Builder execution speed
description: The DBot Builder FAST mode contract lifecycle and its settlement requirement.
---

FAST and SLOW both wait for authoritative settlement before starting the next contract; generated sleep calls do not add wall-clock delays, and both modes consume the subscribed live tick instead of polling tick history in the loop. Generated result checks use the last settled contract, so every loss updates the next stake and every win restores the initial stake.

**Why:** Overlapping contracts committed the next stake before a late loss was known, causing Martingale to skip a loss. Uniform settlement gating is required for deterministic stake progression across every bot.

**How to apply:** Keep one active contract lease in every mode and do not re-arm while a contract is open. Keep the last settled contract separate from the current open contract, default the first result check to the initial-stake path, and apply Martingale only after settlement updates that stored result.