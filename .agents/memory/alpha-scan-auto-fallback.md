---
name: Alpha Scan auto fallback
description: Durable constraints for keeping Auto Runner actionable when strict momentum produces no candidate
---

Auto Runner must use price-direction Rise/Fall contracts only; digit analysis remains available to manual strategy controls but is not an automatic execution fallback.

**Why:** Last-digit execution repeatedly left the live runner without a buy path when digit routes changed or payouts were rejected. Price movement is the requested execution signal and has a single confirmation model.

**How to apply:** Select strict momentum CALL/PUT candidates first, then use a price-only momentum fallback when needed. Confirm the same CALL/PUT direction on fresh prices before buying, and preserve payout, broker availability, one-position, recovery, and session-risk guards.

The public scan and live tick history are separate observations. A strict price-direction candidate can be valid at scan time but stale when the broker history arrives for execution; cancel and rescan rather than switching execution modes.

**Why:** The live site can show Auto Runner ON, an empty trade journal, and repeated fresh-confirmation failures even though the scan itself passed. The journal is correctly empty because no contract was bought; changing into a digit route made that failure harder to diagnose.

**How to apply:** Require a warm live price window, confirm the original CALL/PUT direction for three fresh observations, and return to the queue or rescan if direction fails.

When a fresh proposal fails the payout floor, consume the next qualified queue entry immediately and run a background rescan without clearing the last usable rows.

**Why:** A low-payout proposal is a normal market condition, not a session stop. Clearing the model rows while rescanning can leave Auto Runner enabled but visually stuck at `WAIT` with no next contract.

**How to apply:** Keep payout protection as a hard buy guard, but do not discard the qualified queue; refresh the market universe in parallel while the next candidate goes through its own live confirmation.
