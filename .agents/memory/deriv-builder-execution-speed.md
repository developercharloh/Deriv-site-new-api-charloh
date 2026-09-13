---
name: Builder execution speed
description: The DBot Builder FAST mode contract lifecycle and its settlement requirement.
---

FAST mode uses a one-second broker-tick cadence and may overlap contracts when settlement is late. It still applies Martingale only from authoritative broker-reported results, so a loss updates the next available stake after settlement.

**Why:** The user requires a buy every second without waiting for UI, timer, or settlement delays. Settlement-gating caused missed ticks and made FAST observably slow.

**How to apply:** Keep SLOW single-lease. In FAST, permit one lease per distinct tick and reject same-tick duplicates; re-arm on the next tick while a prior contract is open, and only apply Martingale after each settlement event updates the result.