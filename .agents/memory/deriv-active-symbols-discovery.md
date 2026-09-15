---
name: Deriv symbol metadata
description: Durable discovery constraints for public Synthetic Index symbols
---

Deriv's public `active_symbols` catalogue does not always expose the exact phrase “Synthetic Index” in the brief metadata shape, and the legacy public endpoint can return an empty array even while `ticks_history` works. Synthetic instruments may be labeled as Derived, Volatility, Continuous Indices, or by recognizable symbol families.

**Why:** A strict phrase-only filter produced an empty Alpha Scan even though eligible instruments existed; later, the catalogue endpoint itself returned zero records while direct public history remained available.

**How to apply:** Request the full public metadata shape when possible, match documented market labels, retain a conservative verified-symbol fallback, and validate each fallback symbol with live history before showing it. Keep the result descriptive and paper-only.

The current production options catalogue exposes 13 open Random Index volatilities: 1HZ10V, 1HZ15V, 1HZ25V, 1HZ30V, 1HZ50V, 1HZ75V, 1HZ90V, 1HZ100V, R_10, R_25, R_50, R_75, and R_100. The options WebSocket endpoint is the reliable source for this catalogue; the legacy public endpoint can return no symbols.

**Why:** The live catalogue expanded beyond the older five continuous-index assumptions, and testing against the legacy endpoint falsely made valid symbols appear unavailable.

**How to apply:** Keep volatility pickers and Binary Matrix market handling aligned with the full options-catalogue family, and validate contract support against the options endpoint rather than the legacy `ws.derivws.com/websockets/v3` endpoint.

Dropdown option builders must tolerate an empty or not-yet-hydrated processed-symbol catalogue and return no options or the caller's explicit fallback instead of indexing the catalogue directly.

**Why:** Blockly can create trade-definition blocks before the active-symbol request completes; direct indexing during that window surfaced a user-visible `Cannot read properties of undefined` Journal error.

**How to apply:** Keep public dropdown helpers safe for omitted/undefined catalogue data, and cover the pre-hydration call path in service tests.