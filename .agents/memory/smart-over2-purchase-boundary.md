---
name: Smart Over 2 purchase boundary
description: Runtime purchase safeguards, configurable recovery, virtual trades, and session risk limits.
---

The queued Smart Over 2 order must be authoritative at the shared purchase boundary, not only in generated Blockly blocks, because saved workspaces can still request the old Over 2 purchase. During recovery, require the exact queued contract type and prediction; block recovery requests when no order is ready or another purchase is in flight. At stage 0, preserve legacy normal entries when no staged order exists, while retaining duplicate-purchase protection.

Only report a purchase in the Journal after the broker returns an accepted `buy` response. Until then, keep the pending order and do not mark its stage as purchased. When a dynamic prediction changes, refresh proposals and select only a proposal matching that prediction.

The active strategy has two modes: condition-gated Over using the configured prediction, then ungated Under using the configured recovery prediction after a loss. Every recovery loss repeats that prediction; any win resets the next stake to the original base and returns to condition-gated entries. The editable Martingale factor defaults to 1.2; when Martingale is off, losses must not raise the next stake.

The first condition-gated Over entry is always a real broker purchase; Virtual Hook is recovery-only and begins after that real trade loses. Virtual trades must settle against a broker tick newer than their entry tick, and no new entry may start until a later broker tick. After the configured maximum consecutive virtual losses, latch real-recovery mode: repeat the same real recovery contract after later losses until a win. Settled virtual outcomes may appear in Transactions as zero-stake Hook Won/Hook Lost rows, but must not count as broker trades or financial P/L.

Target Profit and Stop Loss apply to cumulative realized Smart Over 2 session profit. Reaching either threshold must stop the bot through the existing stop-button event. These explicit settings supersede the earlier no-automatic-stop behavior.

**Why:** The approved Smart Over 2 configuration includes editable recovery predictions, Martingale and Virtual Hook toggles, and realized-profit session limits. Keeping virtual outcomes distinct prevents them from being mistaken for broker purchases or restarting the hook after real recovery has begun.

**How to apply:** Keep the normal entry's existing last-X rules unchanged and do not gate recovery on recent digits. Keep queued orders authoritative, apply stake progression only after broker settlement, and test the initial real entry, hook-only-after-loss transition, sticky real recovery, and one-tick settlement cadence.