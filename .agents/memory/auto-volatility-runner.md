---
name: Auto volatility runner
description: Architecture and safety boundaries for scanning multiple Deriv volatility symbols before one-contract execution.
---

Use a dedicated execution controller around the existing DTraderEngine for dynamic volatility selection. Walk the canonical volatility universe one market per scan pass with small history-only requests, keep one rolling status message, rank the completed candidates, subscribe only to the selected market, confirm its direction with fresh ticks, and keep that market through its contract settlement before rescanning.

**Why:** Blockly owns one active symbol and trade definition, so changing it while a contract is open creates subscription, proposal, and settlement races. One-at-a-time history reads avoid rate-limit bursts and thirteen competing broker streams, while a rolling Journal status keeps internal rejection details out of the user-facing log. A settlement-cycle lock preserves one market for the active contract and still allows the next cycle to find a better qualifying market; broad synthetic metadata would also include unrelated Boom/Crash/Step markets.

**How to apply:** Use the canonical symbols from the shared volatility catalog, including continuous and standard volatility indices. Lock a qualified symbol for the confirmation/purchase/settlement cycle, release it when fresh conditions fail, restore it if cycle setup tries to overwrite it, and fail closed if purchase options point elsewhere. Reset it after settlement or session stop. Carry one condition snapshot through rejection, order submission, and broker entry confirmation so Journal rows show available and minimum confidence, ADX, RSI, and MACD values. Prefer a small Adaptive Momentum signal (short/long directional bias plus live confirmation) over stacking every indicator. Keep session loss, target, consecutive-loss, and trade-count stops separate from signal qualification. Treat payout-floor validation as a required next safety layer before unattended buys.

Browser regression coverage should use an isolated deterministic execution fixture rather than attempting to authenticate a real Deriv account; keep that fixture behind an explicit query flag and leave the production engine path unchanged.

**Why:** The routed Alpha Scan page can validate scanning and UI state without credentials, but real execution is account-gated and unsuitable for repeatable browser tests.

**How to apply:** Drive fresh confirmations, one active position, settlement, and the next full-universe scan through the fixture; reserve live execution checks for controlled demo-account testing.