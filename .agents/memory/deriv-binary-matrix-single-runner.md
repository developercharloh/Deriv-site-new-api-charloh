---
name: Binary Matrix single-runner guard
description: Preventing duplicate Binary Matrix contracts when multiple UI launch paths are available
---

Binary Matrix must enforce one active engine across the whole browser window, one automated contract across both native and generated DBot paths, and one purchase per market tick. A browser-global engine lease alone does not stop a generated `Bot.purchase()` call from racing a native purchase or `trade_again` from buying again after settlement on the same tick.

**Why:** Two simultaneous contracts can be opened by separate engine instances or by generated DBot purchase calls before the first buy response changes that engine's state. Releasing the active-contract gate at settlement also permits an immediate same-tick repurchase.

**How to apply:** Keep the browser-global active-engine lease, mark every observed market tick, and acquire a shared automated-contract gate immediately before every native or generated buy. Reject a signal key already used on the current tick, hold the gate through settlement, release it on settlement/errors/stops, and register the run-panel stop handler only after a start succeeds.