---
name: Alpha Scan fixture event order
description: Preserve broker-like open-before-settlement ordering in simulated trades.
---

Fixture contracts must report the open position before settlement. If settlement runs first, session callbacks can clear the active decision before recording the actual traded symbol, making recovery behavior look like a selector defect.

**Why:** A fast fixture settled before its delayed open callback, so the session's last-symbol state stayed empty and same-market recovery appeared to be a production bug.

**How to apply:** When changing fixture timing, keep open-position delivery ahead of settlement and validate recovery using recorded purchase symbols, not journal row order alone.