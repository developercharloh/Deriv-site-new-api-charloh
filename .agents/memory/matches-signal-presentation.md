---
name: Matches signal presentation
description: User expectations for the unified Matches scanner and its connection model.
---

Keep the AI Signals trade-type tab labeled **Matches**, not a digit range. Show the applicable digit ranges on each volatility market's signals, with both setups visible together rather than separated into range tabs.

**Why:** The user explicitly rejected Matches 0–4 and other range-specific tabs, and reported that small, low-contrast signal displays were not readable on mobile.

**How to apply:** Preserve a single Matches entry point, readable per-market range labels and entry status, and alerts-only behavior for the TSI 0–4 and MACD 6–9 setups.

Use the site's established Deriv connection for Matches market data, not a separate legacy endpoint connection.

**Why:** The user reported every market reconnecting while the rest of the site was connected. Live verification using the site's Deriv client and the new feed adapter confirmed history and OHLC updates for all eight one-second indices.

**How to apply:** Keep subscription cleanup scoped to the scanner's own IDs, gate entries on fresh live updates, and verify actual feed messages rather than treating a successful build as evidence of connectivity.
