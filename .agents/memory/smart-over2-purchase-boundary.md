---
name: Smart Over 2 purchase boundary
description: Runtime purchase safeguards and the Over 2 / repeated Under 5 Martingale cycle.
---

The queued Smart Over 2 order must be authoritative at the shared purchase boundary, not only in generated Blockly blocks, because saved workspaces can still request the old Over 2 purchase. During recovery, require the exact queued contract type and prediction; block recovery requests when no order is ready or another purchase is in flight. At stage 0, preserve legacy normal entries when no staged order exists, while retaining duplicate-purchase protection.

Only report a purchase in the Journal after the broker returns an accepted `buy` response. Until then, keep the pending order and do not mark its stage as purchased. When a dynamic prediction changes, refresh proposals and select only a proposal matching that prediction.

The active strategy has two modes: condition-gated Over 2, then ungated Under 5 after any loss. Every recovery loss repeats Under 5; any win resets the next stake to the original base and returns to condition-gated Over 2. The editable Martingale factor defaults to 1.2. Do not add an automatic loss-count stop or stake cap; the user stops the bot manually.

**Why:** The user replaced the earlier multi-stage recovery plan with this two-mode cycle and explicitly requested an editable 1.2× default with no automatic stop.

**How to apply:** Keep Over 2's existing last-X rules unchanged and do not gate Under 5 recovery on recent digits. Multiply the accepted stake after each settled loss, and reset after every settled win. For purchase changes, test stale standard Purchase calls against queued orders, failed or delayed buys retaining the order, accepted buys using the queued contract, and progression applying only after authoritative settlement.