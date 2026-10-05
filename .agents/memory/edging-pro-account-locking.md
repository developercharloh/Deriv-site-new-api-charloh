---
name: Edging Pro account-run locking
description: Preventing concurrent Edging Pro runners from placing duplicate live pairs for one Deriv account.
---

Require a valid active Deriv account ID and an account-scoped exclusive Web Lock before starting the Edging Pro trader; hold the lock until the run stops. If either is unavailable or lock acquisition fails, do not trade. Keep the localStorage owner lease only as a secondary stale-run check, never as permission to run without the Web Lock.

**Why:** localStorage check-then-write is not atomic across tabs, and an optional/missing account ID can bypass account-scoped locking entirely. A refreshed run still showed duplicate paid pairs, so the compatibility path cannot be trusted to authorize trading.

**How to apply:** resolve the current account ID from the active Deriv API/client, acquire `navigator.locks` with `ifAvailable` before starting the trader, hold the callback pending for the run lifetime, and release on stop. Fail closed on unsupported browsers or rejected lock requests; test concurrent starts and duplicate proposal responses.
