---
name: Deriv Higher/Lower proposal schema
description: Live Deriv proposal requirements for Higher/Lower contracts on synthetic indices
---

Use `HIGHER` and `LOWER` as the proposal contract types. Do not substitute `CALL` and `PUT`; those produce invalid-barrier failures when a barrier is supplied. Higher/Lower tick proposals also require 5–10 ticks, and the barrier offset must match the market's current contracts-for metadata. For `1HZ100V`, the live tick barrier observed on September 22, 2026 was `+0.14` for both directions; the direction is carried by the contract type, not by a negative Lower barrier.

**Why:** The legacy runner comments described `CALL`/`PUT` with `+0.001`/`-0.001`, but the live broker rejected that shape. The current proposal API documentation and live API probe accepted `HIGHER`/`LOWER` with a valid positive offset and rejected one-tick Higher/Lower requests.

**How to apply:** When changing the HL master runner, verify the symbol's `contracts_for` tick barrier instead of assuming the default from older DBot code. Keep the paired stake behavior independent from the contract-type mapping.