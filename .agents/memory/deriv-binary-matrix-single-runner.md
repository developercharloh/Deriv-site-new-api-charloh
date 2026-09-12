---
name: Binary Matrix single-runner guard
description: Preventing duplicate Binary Matrix contracts when multiple UI launch paths are available
---

Binary Matrix must run through the generated XML/DBot path, enforce one automated contract, and allow only one purchase per market tick. Do not silently divert compatibility blocks to a separate native runner; a browser-global engine lease alone does not stop generated `Bot.purchase()` re-entry or `trade_again` from buying again after settlement.

**Why:** The separate native path made the visible XML bot behave differently from every other DBot bot and allowed duplicate behavior to persist outside the generated purchase lifecycle. Releasing the active-contract gate at settlement also permits an immediate same-tick repurchase.

**How to apply:** Load Binary Matrix into the normal Builder and let the standard Run flow execute it. Mark every observed market tick, derive the generated engine's signal key from its own Redux tick epoch when purchasing, reject a signal key already used on the current tick, hold the gate through settlement, and release it on settlement/errors/stops.