---
name: Smart Over 2 purchase boundary
description: Runtime purchase safeguards, configurable recovery, virtual trades, and session risk limits.
---

The queued Smart Over 2 order must be authoritative at the shared purchase boundary, not only in generated Blockly blocks, because saved workspaces can still request the old Over 2 purchase. During recovery, require the exact queued contract type and prediction; block recovery requests when no order is ready or another purchase is in flight. At stage 0, preserve legacy normal entries when no staged order exists, while retaining duplicate-purchase protection.

Only report a purchase in the Journal after the broker returns an accepted `buy` response. Until then, keep the pending order and do not mark its stage as purchased. When a dynamic prediction changes, refresh proposals and select only a proposal matching that prediction.

The active strategy has two modes: condition-gated Over using the configured prediction, then ungated Under using the configured recovery prediction after a loss. Every recovery loss repeats that prediction; any win resets the next stake to the original base and returns to condition-gated entries. The editable Martingale factor defaults to 1.2; when Martingale is off, losses must not raise the next stake.

Virtual trades must settle against a broker tick newer than their entry tick. After a virtual settlement, do not start another virtual or live entry until a later broker tick. The configured maximum virtual losses controls when the strategy moves from virtual to real purchases.

Target Profit and Stop Loss apply to cumulative realized Smart Over 2 session profit. Reaching either threshold must stop the bot through the existing stop-button event. These explicit settings supersede the earlier no-automatic-stop behavior.

**Why:** The approved Smart Over 2 configuration now includes editable recovery predictions, Martingale and Virtual Hook toggles, and realized-profit session limits; virtual outcomes must preserve the real strategy's one-tick cadence.

**How to apply:** Keep the normal entry's existing last-X rules unchanged and do not gate recovery on recent digits. Keep queued orders authoritative, apply stake progression only after broker settlement, and test that virtual settlement cannot trigger another entry on the same tick.