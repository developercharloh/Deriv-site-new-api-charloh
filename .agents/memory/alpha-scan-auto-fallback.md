---
name: Alpha Scan auto fallback
description: Durable constraints for keeping Auto Runner actionable when strict momentum produces no candidate
---

Auto Runner must fall back to the strongest available adaptive digit route when no strict momentum market qualifies, while keeping the strict momentum route unchanged when candidates exist.

**Why:** A strict confidence gate can legitimately return no candidate even though the live market has usable digit evidence. Without a fallback, Auto Runner can remain enabled but never submit an entry. The two routes also require different fresh-confirmation semantics.

**How to apply:** Use momentum confirmation for strict candidates and same-route digit confirmation for fallback candidates. Keep the distinction in the pending-entry state, include every referenced selection value in the callback dependencies, and preserve payout, broker availability, one-position, recovery, and session-risk guards. If a strict scan candidate no longer matches a warm live history, reselect the current digit route and send it through fresh confirmation instead of cancelling back to idle.

The public scan and live tick history are separate observations. A strict candidate can be valid at scan time but stale when the broker history arrives for execution; this should trigger a live-route handoff, not a journaled trade or an indefinite idle loop.

**Why:** The live site can show Auto Runner ON, an empty trade journal, and repeated fresh-confirmation failures even though the scan itself passed. The journal is correctly empty because no contract was bought; the real fix is to avoid treating stale scan direction as the only executable route.

**How to apply:** Require a warm live window before switching from stale momentum to a current digit route, then restart the pending proposal with an explicit digit confirmation mode so broker payout and contract-availability guards still run.