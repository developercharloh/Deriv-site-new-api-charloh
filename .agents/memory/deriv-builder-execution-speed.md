---
name: Builder execution speed
description: The DBot Builder FAST mode contract lifecycle and its settlement requirement.
---

FAST mode must not overlap contracts. It removes timer-based/artificial waits, but the current contract must emit its final settlement before the engine can acquire the next contract lease. The next purchase may proceed on the next live tick after the result has updated the stake.

**Why:** Martingale and win/loss branching require an authoritative settled result. Overlapping contracts let the next purchase use stale stake state and make the Builder appear to ignore losses.

**How to apply:** Keep the automated contract gate single-lease in every execution speed, dispatch the settled/sold transition for FAST as well as SLOW, and test loss → win stake progression with zero open contracts at the second purchase.