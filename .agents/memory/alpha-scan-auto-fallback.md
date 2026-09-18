---
name: Alpha Scan auto fallback
description: Durable constraints for keeping Auto Runner actionable when strict momentum produces no candidate
---

Auto Runner must fall back to the strongest available adaptive digit route when no strict momentum market qualifies, while keeping the strict momentum route unchanged when candidates exist.

**Why:** A strict confidence gate can legitimately return no candidate even though the live market has usable digit evidence. Without a fallback, Auto Runner can remain enabled but never submit an entry. The two routes also require different fresh-confirmation semantics.

**How to apply:** Use momentum confirmation for strict candidates and same-route digit confirmation for fallback candidates. Keep the distinction in the pending-entry state, include every referenced selection value in the callback dependencies, and preserve payout, broker availability, one-position, recovery, and session-risk guards.