---
name: Binary Matrix single-runner guard
description: Preventing duplicate Binary Matrix contracts when multiple UI launch paths are available
---

Binary Matrix must enforce one active engine across the whole browser window, not only one buy per `DTraderEngine` instance or one module copy. The Free Bots modal and DBot Builder native-run path can otherwise create separate engines, each with its own in-flight lock.

**Why:** Two simultaneous contracts were opened because both engine instances independently observed the same qualifying digit pattern and each submitted one purchase.

**How to apply:** Keep a browser-global active-engine lease, reject a second `start()`, and register the run-panel stop handler only after a start succeeds so a rejected runner cannot clear the active runner's control.