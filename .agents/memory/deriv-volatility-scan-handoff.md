---
name: Volatility scan purchase handoff
description: Keep volatility market diagnostics from delaying an already qualified Rise/Fall entry
---

The volatility scanner must evaluate the full candidate universe before handing a market to the purchase path. Once selected, one strongest qualified market owns the live subscription and purchase path; no later market may replace it.

**Why:** A first-qualified handoff allowed later markets to appear stronger, while background diagnostics made multiple qualifying markets look actionable and the selected contract could stop without the best candidate being used.

**How to apply:** Scan all markets with history-only requests, rank qualified records by passing-indicator count, confidence, and indicator margins, then preserve the selected market, direction, and live subscription through the purchase cycle.

Background diagnostic results may still retain `qualifies: true` for telemetry, but they must carry an explicit diagnostic marker and never be rendered as executable recommendations. The first handoff is the only actionable qualification.

**Why:** A later diagnostic result was displayed with the same recommendation label as the locked market, making a correct first-market lock look like multiple executable selections.

**How to apply:** Keep selection state on the engine lock, and distinguish first-qualified versus diagnostic-only states in every user-facing scan event.

Once the scan has selected a market, do not run a second refresh-dependent indicator gate before the generated purchase block. The scan's MACD plus ADX/RSI result is authoritative for that purchase cycle; later refreshed values can change without invalidating the completed handoff.

**Why:** The Journal could show a fully qualified selected market and then submit no order because a duplicate post-scan Blockly gate silently evaluated refreshed OHLC data and stopped before `purchase()`.

**How to apply:** Keep the symbol lock and contract gate as safety barriers, but preserve the selected scan values for the cycle and let the generated purchase path proceed once the selection resolves successfully.

FAST execution must also preserve the selected direction after settlement and reuse the selected scan's candle input instead of requesting fresh OHLC data before every same-session purchase.

**Why:** The reference execution repeatedly bought the same direction immediately after one-second settlements, while the bot's loss handler alternated CALL/PUT and its next Blockly cycle added a fresh history request.

**How to apply:** Treat direction as part of the session lock, make loss handling stake-only, and let the FAST path use the locked market, direction, indicators, and cached execution input until reset or an explicit live failure.

For locked Rise/Fall FAST sessions, the settlement event should release the generated during-purchase cycle, let the existing after-purchase stack apply stake and stop rules, and have the next `start()` submit the locked direction directly while skipping only the redundant before-purchase stack.

**Why:** The reference engine's rapid cadence comes from settlement-to-next-purchase handoff, not from allowing uncontrolled overlapping contracts or waiting for another analysis pass.

**How to apply:** Keep the normal proposal refresh, contract gate, and broker purchase implementation; use an explicit settlement handoff flag and preserve the during-purchase watcher for the newly submitted contract.