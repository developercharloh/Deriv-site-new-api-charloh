---
name: Smart Over 2 purchase boundary
description: Runtime enforcement and journaling semantics for staged Smart Over 2 purchases when saved workspaces are stale.
---

The queued Smart Over 2 order must be authoritative at the shared purchase boundary, not only in generated Blockly blocks, because saved workspaces can still request the old Over 2 purchase. During recovery, require the exact queued contract type and prediction; block recovery requests when no order is ready or another purchase is in flight. At stage 0, preserve legacy normal entries when no staged order exists, while retaining duplicate-purchase protection.

Only report a purchase in the Journal after the broker returns an accepted `buy` response. Until then, keep the pending order and do not mark its stage as purchased. When a dynamic prediction changes, refresh proposals and select only a proposal matching that prediction.

**Why:** The user provided evidence that the Journal described Recovery 1 Over 4 while purchase mapping and transaction records showed Over 2. A strategy's intended order is not proof of the contract actually sent.

**How to apply:** For Smart Over 2 changes, test stale standard Purchase calls against queued recovery orders, proposal refresh and prediction matching, failed or delayed buys retaining the order, and successful buys logging the accepted barrier. Preserve Recovery 3 behavior and the transparency report unless explicitly asked to change them.