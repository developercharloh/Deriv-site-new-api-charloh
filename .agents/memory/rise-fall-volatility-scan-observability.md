---
name: Rise/Fall volatility scan observability
description: Execution and reporting constraints for the Rise/Fall Master Bot volatility selector
---

The volatility scanner owns the recommended CALL/PUT direction for a selected market. Template-level smart-entry logic must not overwrite that direction before the MACD-plus-one-indicator purchase gate runs.

**Why:** A qualified market could be selected correctly and then fail the live gate because the first-trade smart-entry branch replaced the scanner direction with the most recent tick trend.

Per-market scan events should retain RSI, MACD, ADX, signal, thresholds, and the recommendation result. The journal should keep each market result while using a separate replaceable status row for the currently checked market and final selection.

**How to apply:** When extending the scanner, treat the selected signal as authoritative for execution and preserve readable market-by-market diagnostics instead of replacing all scan history with one transient message.

History-only requests may fail transiently while the selected market has a live stream. Retry with bounded backoff and a small gap between markets before reporting indicator values as unavailable.

**Why:** Rapid sequential broker history requests can be rate-limited or collide with active stream state, producing misleading all-N/A scan rows even when the markets are available.

**How to apply:** Keep retries inside the scanner, and reserve `DATA UNAVAILABLE` for a request that remains unsuccessful after the bounded retry policy.

For the Rise/Fall Master Bot, return control to the purchase branch as soon as the current market qualifies; do not require the remaining volatility universe to finish first.

**Why:** The Blockly before-purchase condition skips its entire purchase stack whenever the scanner returns false, so a qualified mid-scan market can be displayed as RECOMMENDED without any trade attempt.

**How to apply:** Emit the per-market result, lock the qualified symbol and direction, then return true and let the live purchase gate perform the final confirmation.