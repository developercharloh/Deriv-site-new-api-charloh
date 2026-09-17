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