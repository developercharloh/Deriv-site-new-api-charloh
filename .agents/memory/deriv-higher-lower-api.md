---
name: Deriv Higher/Lower proposal schema
description: Live Deriv proposal requirements for Higher/Lower contracts on synthetic indices
---

Use `HIGHER` and `LOWER` as the proposal contract types. Do not substitute `CALL` and `PUT`; those produce invalid-barrier failures when a barrier is supplied. Higher/Lower tick proposals also require 5–10 ticks, and the barrier offset must match the requested direction and market. For `1HZ100V`, a 5-tick live probe accepted `+1` for HIGHER and `-1` for LOWER; a LOWER `+1` request was rejected as offering no return.

**Why:** The legacy runner comments described `CALL`/`PUT` with `+0.001`/`-0.001`, but the live broker rejected that shape. The current proposal API documentation and live API probes accepted `HIGHER`/`LOWER` with signed offsets and rejected one-tick Higher/Lower requests.

**How to apply:** When changing the HL master runner, verify the symbol's `contracts_for` tick barrier instead of assuming the default from older DBot code. Keep the paired stake behavior independent from the contract-type mapping.