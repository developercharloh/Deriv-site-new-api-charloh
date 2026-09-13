---
name: Builder execution speed
description: The DBot Builder FAST wall-clock schedule, one-second contracts, and settlement handling.
---

FAST uses an engine-owned wall-clock slot every 1500 ms, with the first slot available immediately, for up to 40 slots per minute. It keeps only one unresolved contract, so a slot is skipped while Deriv is still settling the previous trade. For synthetic digit markets, its broker contract uses the supported 1-tick equivalent because Deriv does not offer a 1-second duration there. SLOW keeps Deriv's normal subscribed-tick entry flow and configured duration. Settlement remains authoritative for totals and Martingale, and generated result checks use the latest settled contract.

**Why:** A 1.5-second cadence gives roughly 40 opportunities per minute while leaving more time for one-tick synthetic contracts to settle. Deriv rejects duration 1s for the selected synthetic digit market because its seconds minimum is 15, while one tick is the supported roughly one-second contract. Preventing overlap keeps Martingale from committing a new stake before the prior result is authoritative.

**How to apply:** Keep one shared account owner and one active FAST lease; reject leases from other bot runners and skip clock slots while the active lease remains unresolved. Do not let FAST settlement handlers re-arm the next purchase; the clock owns scheduling. Update stake progression only on settlement, keep the last settled contract separate from the current open contract, and preserve the SLOW path unchanged.