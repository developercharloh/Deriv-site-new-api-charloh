---
name: FAST gate test isolation
description: Shared automated-contract gate state can retain the last-used FAST signal key after a lease is released
---

Tests that exercise FAST re-entry should use an isolated signal key or explicitly reset the shared gate state before the next scenario. Releasing a lease removes the active owner but intentionally preserves the last-used key to reject duplicate same-slot purchases.

**Why:** A focused settlement/prewarm test left a synthetic `fast:1` key behind, causing a later generated FAST harness to reject its legitimate first slot when the suite ran in one process.

**How to apply:** Prefer distinctive synthetic FAST keys in focused tests; do not assume `releaseBotContractGate` resets the global last-used slot.