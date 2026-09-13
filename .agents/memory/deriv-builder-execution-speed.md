---
name: Builder execution speed
description: The DBot Builder FAST mode contract lifecycle and its settlement requirement.
---

FAST mode uses a one-second broker-tick cadence and may overlap contracts when settlement is late. SLOW generated sleep calls yield to broker ticks instead of adding wall-clock delays. Generated result checks must use the last authoritative settlement, not the newer open contract; a loss updates the next available stake and a win restores the initial stake.

**Why:** The user requires a buy every second without waiting for UI, timer, or settlement delays. Settlement-gating caused missed ticks and made FAST observably slow.

**How to apply:** Keep SLOW single-lease and event-driven. In FAST, permit one lease per distinct tick and reject same-tick duplicates; re-arm on the next tick while a prior contract is open. Keep the last settled contract separate from the current open contract, default the first result check to the initial-stake path, and apply Martingale only after settlement updates that stored result.