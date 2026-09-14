---
name: SLOW live tick monitor
description: The distinction between cached tick history and an active broker tick listener.
---

SLOW execution requires an active broker tick monitor for every reused engine epoch. A resolved or warm history promise can provide cached data without registering that engine’s live listener, and same-symbol initialization must still restore a missing listener.

**Why:** Reused interpreters can inherit warm history state and otherwise wait indefinitely for fresh broker ticks, so the first trade may work while repeated SLOW cycles silently stop.

**How to apply:** Treat the listener key, not the history promise, as the monitor-health signal. When the key is absent, reattach the monitor even if the symbol is unchanged; preserve FAST cadence and pause behavior.