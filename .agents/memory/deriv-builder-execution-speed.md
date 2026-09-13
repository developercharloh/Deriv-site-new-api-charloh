---
name: Builder execution speed
description: The DBot Builder FAST mode contract lifecycle and its settlement requirement.
---

FAST mode must not overlap contracts. It removes timer-based/artificial waits and extra continuation handoffs, and does not impose an extra market-tick boundary in the interpreter loop, but the current contract must emit its final positive/negative settlement before the engine can acquire the next contract lease. The next purchase may re-enter immediately on that same settled tick after the result has updated the stake.

**Why:** Martingale and win/loss branching require an authoritative settled result. Overlapping contracts let the next purchase use stale stake state and make the Builder appear to ignore losses.

**How to apply:** Keep the automated contract gate single-lease in every execution speed, dispatch the settled/sold transition for FAST as well as SLOW, do not add a tick wait to FAST sleep/re-entry, grant only one same-tick FAST re-entry from the settlement event, and test loss → win stake progression with zero open contracts at the second purchase.