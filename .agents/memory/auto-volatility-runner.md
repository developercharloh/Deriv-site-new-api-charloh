---
name: Auto volatility runner
description: Architecture and safety boundaries for scanning multiple Deriv volatility symbols before one-contract execution.
---

Use a dedicated execution controller around the existing DTraderEngine for dynamic volatility selection. Keep Blockly strategies fixed-symbol; scan the canonical volatility universe before each new contract, confirm the selected direction with fresh ticks, and hold the symbol until settlement.

**Why:** Blockly owns a single symbol and trade definition, so mutating it during an open contract creates subscription, proposal, and settlement races. The controller can enforce one active contract and rescan only between contracts.

**How to apply:** Prefer a small Adaptive Momentum signal (short/long directional bias plus live confirmation) over stacking every indicator. Keep session loss, target, consecutive-loss, and trade-count stops separate from signal qualification. Treat payout-floor validation as a required next safety layer before unattended buys.