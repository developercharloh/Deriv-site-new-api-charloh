---
name: Edging Pro account-run locking
description: Preventing concurrent Edging Pro runners from placing duplicate live pairs for one Deriv account.
---

Use an account-scoped exclusive Web Lock before starting the Edging Pro trader and hold it until the run stops. Keep the localStorage owner lease as a compatibility and stale-run recovery layer, not as the sole mutual-exclusion mechanism.

**Why:** localStorage check-then-write is not atomic across tabs; two nearly simultaneous starts can both observe an empty lease and proceed before either heartbeat detects the other.

**How to apply:** acquire `navigator.locks` with `ifAvailable` before starting the trader, keep the lock callback pending for the run lifetime, and release it on every stop or failed start. Retain the localStorage lease for legacy browser versions and test near-simultaneous account starts.
