---
name: Alpha Scan queued execution
description: Durable testing and safety constraints for automatic execution across multiple qualified markets.
---

Automatic Alpha Scan execution must keep the engine’s single-position invariant while consuming the ranked qualified-market queue sequentially. A settlement can hand off directly to the next pending market, so the UI may not expose a zero-open-row gap between contracts.

**Why:** The multi-market runner is intentionally sequential rather than simultaneous, and transient feedback or idle states can be replaced immediately by the next confirmation. Tests that assume one best market or a visible idle gap miss valid queue behavior.

**How to apply:** Assert completed-trade counters, distinct executed symbols, and non-empty current/entry/exit journal prices. Keep payout, fresh-confirmation, recovery, and session-risk guards authoritative before advancing the queue.