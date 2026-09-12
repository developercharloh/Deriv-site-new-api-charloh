---
name: Binary Matrix single-runner guard
description: Preventing duplicate Binary Matrix contracts when multiple UI launch paths are available
---

Binary Matrix must enforce one active engine across the whole browser window and one automated contract across both native and generated DBot paths. A browser-global engine lease alone does not stop a generated `Bot.purchase()` call from racing a native purchase.

**Why:** Two simultaneous contracts can be opened by separate engine instances or by generated DBot purchase calls before the first buy response changes that engine's state.

**How to apply:** Keep the browser-global active-engine lease, and also acquire a shared automated-contract gate immediately before every native or generated buy. Hold it through settlement, release it on settlement/errors/stops, and register the run-panel stop handler only after a start succeeds.