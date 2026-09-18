---
name: Alpha Scan adaptive execution
description: Live Alpha Scan execution and public-feed throttling constraints
---

Alpha Scan history requests should be serialized one symbol at a time; concurrent bursts can make valid Synthetic Index symbols appear unavailable even when the feed supports them.

**Why:** The public feed returned complete coverage when history reads were paced, while the previous burst pattern produced a misleading Volatility 75-only surface.

**How to apply:** Keep discovery broad, validate every discovered symbol with paced history reads, and expose partial failures instead of silently shrinking the universe.

Automatic momentum direction and purchase market are separate decisions. Preserve CALL/PUT as the fresh-tick confirmation signal while mapping the approved entry to an adaptive digit contract and its paired recovery barrier.

**Why:** Replacing the momentum condition with DIGITOVER/DIGITUNDER made fresh confirmation compare incompatible contract types and blocked the runner.

**How to apply:** Use Over 2 → Over 4 and Under 7 → Under 5 as preferred pairs, with parity fallback, and do not restart the live engine merely because a newly computed recovery object has a new identity.