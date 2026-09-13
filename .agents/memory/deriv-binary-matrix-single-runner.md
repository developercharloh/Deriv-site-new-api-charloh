---
name: Binary Matrix single-runner guard
description: Preventing duplicate Binary Matrix contracts when multiple UI launch paths are available
---

Binary Matrix must run through the generated XML/DBot path, enforce one automated contract, and allow only one purchase per market tick. Do not silently divert compatibility blocks to a separate native runner; a browser-global engine lease alone does not stop generated `Bot.purchase()` re-entry or `trade_again` from buying again after settlement.

**Why:** The separate native path made the visible XML bot behave differently from every other DBot bot and allowed duplicate behavior to persist outside the generated purchase lifecycle. Releasing the active-contract gate at settlement also permits an immediate same-tick repurchase.

**How to apply:** Load Binary Matrix into the normal Builder and let the standard Run flow execute it. Mark every observed market tick, preserve that Redux tick epoch across purchase/settlement scope transitions, derive the generated engine's signal key from it when purchasing, reject a signal key already used on the current tick, hold the gate through settlement, and release it on settlement/errors/stops.

FAST execution means the generated loop advances on the next live tick, not that it polls the same tick with a shorter timer. SLOW remains the legacy delay behavior.

**Why:** A shorter timer can re-evaluate stale ticks repeatedly and does not represent “trade every tick”; tick-driven advancement gives FAST its intended meaning without weakening purchase or settlement guards.

**How to apply:** Emit a per-engine tick event from the live tick callback, wait for that event in the FAST idle loop, and keep the one-contract/one-purchase-per-tick gate unchanged.

The standard workspace validator must treat `apollo_purchase2` as a valid alias for the mandatory `purchase` block; the custom block is required to carry Binary Matrix prediction barriers.

**Why:** The XML can be structurally valid and executable while still failing DBot's hard-coded required-block check if only the custom purchase type is present.

**How to apply:** Keep the alias in required-block presence, disabled-block, and error-message validation whenever the Binary Matrix XML uses `apollo_purchase2`.

Custom XML purchase blocks must forward their prediction argument through the generated Bot interface into the direct buy payload; otherwise Deriv rejects digit Over/Under contracts for missing barriers.

**Why:** The standard purchase interface historically accepted only the contract type, silently dropping the custom block's Over/Under prediction.

**How to apply:** Preserve the two-argument purchase contract (`contract_type`, optional prediction) and verify the resulting buy request contains `barrier` for Over/Under while Even/Odd remain barrier-free.

The generated XML remains the execution path, but Binary Matrix stake progression must also be enforced in the trade engine from authoritative settlement profit. The Blockly `Stake` variable alone can lag the next FAST purchase.

**Why:** FAST can resume the generated loop on a settlement event before a variable update is reflected in the next broker request, producing a base-stake buy after a loss or a multiplied buy after a win.

**How to apply:** Capture the first requested stake and configured Martingale factor, update the engine state on final settlement, and override only Binary Matrix trade-option amounts for the next buy; leave ordinary DBot strategies unchanged.
