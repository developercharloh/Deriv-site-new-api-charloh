---
name: Builder execution speed
description: The DBot Builder FAST wall-clock schedule, one-second contracts, and settlement handling.
---

FAST uses an engine-owned wall-clock slot every 1000 ms, with the first slot available immediately. For synthetic digit markets, its broker contract uses the supported 1-tick equivalent because Deriv does not offer a 1-second duration there. The clock, not ticks or settlement, releases the next purchase slot, so multiple one-second-cadence contracts may be in flight while Deriv reports earlier settlements. SLOW keeps Deriv's normal subscribed-tick entry flow and configured duration. Settlement remains authoritative for totals and Martingale, and generated result checks use the latest settled contract.

**Why:** The required FAST behavior is uniform one-second execution: a continuously running bot has 60 scheduled purchase slots in a one-minute window. Deriv rejects duration 1s for the selected synthetic digit market because its seconds minimum is 15, while one tick is the supported roughly one-second contract. A settlement-gated or tick-gated loop cannot guarantee the cadence. Martingale still must wait for authoritative settlement, even when the next purchase slot has already opened.

**How to apply:** Keep one shared account owner, but allow that owner to hold multiple clock-paced FAST leases; reject leases from other bot runners. Do not let FAST settlement handlers re-arm or block the clock. Update stake progression only on settlement, keep the last settled contract separate from current open contracts, and preserve the SLOW path unchanged.