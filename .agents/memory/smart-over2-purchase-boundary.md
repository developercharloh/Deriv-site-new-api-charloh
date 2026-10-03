---
name: Smart Over 2 purchase boundary
description: Runtime purchase safeguards, configurable recovery, virtual trades, and session risk limits.
---

The queued Smart Over 2 order must be authoritative at the shared purchase boundary, not only in generated Blockly blocks, because saved workspaces can still request the old Over 2 purchase. During recovery, require the exact queued contract type and prediction; block recovery requests when no order is ready or another purchase is in flight. At stage 0, preserve legacy normal entries when no staged order exists, while retaining duplicate-purchase protection.

Only report a purchase in the Journal after the broker returns an accepted `buy` response. Until then, keep the pending order and do not mark its stage as purchased. When a dynamic prediction changes, refresh proposals and select only a proposal matching that prediction.

Normal entries are condition-gated Over using the configured Over prediction. After a real Over loss, the Virtual Hook repeatedly simulates Under using its configured prediction. A virtual win resets the consecutive-loss count but keeps the hook active; only the configured number of consecutive virtual losses triggers a real Under recovery purchase. A real Under win resets the stake and returns to condition-gated Over entries. A real Under loss applies Martingale and restarts the Virtual Hook cycle before another real Under recovery. Virtual outcomes affect only the hook-loss count, never broker P/L or stake.

The first condition-gated Over entry is always a real broker purchase; Virtual Hook is recovery-only and begins after that real trade loses. Virtual trades must settle against a broker tick newer than their entry tick, and no new entry may start until a later broker tick. After the configured maximum consecutive virtual losses, place one real Under recovery contract using the configured Under prediction (Under 5 by default). Do not latch real recovery after a loss: apply the real-loss stake progression, restart the hook-loss count, and require a fresh run of consecutive virtual losses before the next real Under purchase. Settled virtual outcomes may appear in Transactions as zero-stake Hook Won/Hook Lost rows, but must not count as broker trades or financial P/L.

Target Profit and Stop Loss apply to cumulative realized Smart Over 2 session profit. Reaching either threshold must stop the bot through the existing stop-button event. These explicit settings supersede the earlier no-automatic-stop behavior.

**Why:** Real recovery and Virtual Hook are separate stages: a virtual win must not exit hook mode, and the real contract after the loss threshold must remain Under. Treating a real recovery loss as another immediate real recovery would skip the intended Virtual Hook cycle.

**How to apply:** Keep normal Over entries' existing last-X rules unchanged and do not gate real Under recovery on recent digits. Virtual wins reset only the consecutive-loss counter and continue the hook; virtual losses increase it. Real Under wins return to normal Over entries; real Under losses apply Martingale and begin a fresh hook cycle. Keep queued orders authoritative, change stake only for real settlements, and test both threshold transitions and one-tick settlement cadence.