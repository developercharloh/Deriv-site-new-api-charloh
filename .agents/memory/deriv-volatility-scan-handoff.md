---
name: Volatility scan purchase handoff
description: Keep volatility market diagnostics from delaying an already qualified Rise/Fall entry
---

The volatility scanner must hand off a qualified market to the purchase path immediately. Any remaining real-history checks belong to a cancellable background diagnostic pass, so a full-universe scan cannot leave a qualified contract waiting indefinitely.

**Why:** A full sequential scan emitted a recommended market but continued waiting on later markets, which made the bot appear to recognize the signal without buying.

**How to apply:** Preserve the selected market, direction, and live subscription before starting background checks. Cancel diagnostics when a new settlement rescan or selection reset begins, and keep broker history failures visible with their code and message.

Background diagnostic results may still retain `qualifies: true` for telemetry, but they must carry an explicit diagnostic marker and never be rendered as executable recommendations. The first handoff is the only actionable qualification.

**Why:** A later diagnostic result was displayed with the same recommendation label as the locked market, making a correct first-market lock look like multiple executable selections.

**How to apply:** Keep selection state on the engine lock, and distinguish first-qualified versus diagnostic-only states in every user-facing scan event.