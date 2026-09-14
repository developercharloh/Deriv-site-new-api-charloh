---
name: AI signal scanner safety
description: Reliability and freshness rules for the multi-market AI Signals scanner.
---

The scanner must treat every market history request as settled whether it returns data or an API error, and it must use a bounded history window and timeout so one unavailable symbol cannot hold the feed in a loading state.

**Why:** A missing or rejected market response previously prevented the completion counter from reaching the total, leaving the UI on “Scanning markets…” and delaying all usable results.

**How to apply:** Keep partial/unavailable markets visible as a reconnecting condition, retry at a controlled cadence, and preserve conservative statistical gates rather than lowering them just to create signals.

Execution must require a current live watchdog confirmation; a signal that is warming, weakening, reversed, or no longer receiving ticks must be blocked and re-scanned.

**Why:** Historical qualification can become stale while the market moves, and a stopped tick feed can otherwise leave an old “holding” state actionable.

**How to apply:** Gate both card-level and final execution controls on a holding watchdog with a recent tick, while keeping the signal’s live status visible to the user.