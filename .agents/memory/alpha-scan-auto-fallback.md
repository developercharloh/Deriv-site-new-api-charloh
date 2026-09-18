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

When an adaptive digit fallback changes during confirmation, update the pending decision and engine configuration in place while preserving the warm subscription; do not reset the engine just to restart confirmation.

**Why:** A stop/start handoff can lose the live confirmation stream or race subscription cleanup, leaving the runner visibly pending without reaching a buy even though the new route is valid.

**How to apply:** Update the expected route while keeping the active leg pending and preserving confirmations already observed on fresh ticks; let the live stream complete the three-tick confirmation before invoking the existing payout and buy guards.

When a fresh proposal fails the payout floor, consume the next qualified queue entry immediately and run a background rescan without clearing the last usable rows.

**Why:** A low-payout proposal is a normal market condition, not a session stop. Clearing the model rows while rescanning can leave Auto Runner enabled but visually stuck at `WAIT` with no next contract.

**How to apply:** Keep payout protection as a hard buy guard, but do not discard the qualified queue; refresh the market universe in parallel while the next candidate goes through its own live confirmation.