---
name: Auto volatility runner
description: Architecture and safety boundaries for scanning multiple Deriv volatility symbols before one-contract execution.
---

Use a dedicated execution controller around the existing DTraderEngine for dynamic volatility selection. Keep Blockly strategies fixed-symbol; scan the canonical volatility universe once at the start of a bot session, confirm the selected direction with fresh ticks, and keep every purchase on that selected symbol until the session stops or restarts.

**Why:** Blockly owns a single symbol and trade definition, so changing it on every purchase cycle creates subscription, proposal, and settlement races and can send a later signal to a different market. A session lock preserves one market for the entire run; broad synthetic metadata would also include unrelated Boom/Crash/Step markets.

**How to apply:** Use the canonical symbols from the shared volatility catalog, including continuous and standard volatility indices. Lock the first qualified symbol for the bot session, restore that symbol if cycle setup tries to overwrite it, and fail closed if the purchase options point elsewhere. Reset the lock only when the bot session stops or restarts. Prefer a small Adaptive Momentum signal (short/long directional bias plus live confirmation) over stacking every indicator. Keep session loss, target, consecutive-loss, and trade-count stops separate from signal qualification. Treat payout-floor validation as a required next safety layer before unattended buys.

Browser regression coverage should use an isolated deterministic execution fixture rather than attempting to authenticate a real Deriv account; keep that fixture behind an explicit query flag and leave the production engine path unchanged.

**Why:** The routed Alpha Scan page can validate scanning and UI state without credentials, but real execution is account-gated and unsuitable for repeatable browser tests.

**How to apply:** Drive fresh confirmations, one active position, settlement, and the next full-universe scan through the fixture; reserve live execution checks for controlled demo-account testing.