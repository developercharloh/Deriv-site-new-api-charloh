---
name: Smart Over 2 purchase boundary
description: Runtime enforcement and journaling semantics for staged Smart Over 2 purchases when saved workspaces are stale.
---

The queued Smart Over 2 order must be authoritative at the shared purchase boundary, not only in generated Blockly blocks, because saved workspaces can still request the old Over 2 purchase. During recovery, require the exact queued contract type and prediction; block recovery requests when no order is ready or another purchase is in flight. At stage 0, preserve legacy normal entries when no staged order exists, while retaining duplicate-purchase protection.

Only report a purchase in the Journal after the broker returns an accepted `buy` response. Until then, keep the pending order and do not mark its stage as purchased. When a dynamic prediction changes, refresh proposals and select only a proposal matching that prediction.

**Why:** The user reported that the Journal described Recovery 1 Over 4 while purchase mapping and transaction records showed Over 2. They then specified Under 5 for Recovery 1 after a normal Over 2 loss, while asking to preserve Recovery 2, Recovery 3, and the transparency report.

**How to apply:** Recovery 1 after a normal Over 2 loss is Under 5 with no last-X gate. Keep Recovery 2's last-X-below-4 gate followed by Over 4 and Recovery 3's Over 4/Under 4 analysis unchanged unless the user requests otherwise. For purchase changes, test stale standard Purchase calls against queued orders, proposal refresh and prediction matching, failed or delayed buys retaining the order, and successful buys logging the accepted barrier.