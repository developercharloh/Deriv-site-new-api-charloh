---
name: Deriv feed recovery
description: Recovery patterns for authenticated tick subscriptions and public market scans
---

Deriv allows only one live tick subscription per symbol on a connection. A fast bot stop/start or another trading surface can leave the previous stream active briefly; recover by awaiting the connection API's `forgetAll('ticks')` cleanup before retrying the history subscription.

**Why:** Sending a new history request immediately after a local `forget` races Deriv's remote cleanup and produces `AlreadySubscribed`, leaving the bot showing as running while no qualifying ticks reach the strategy.

**How to apply:** Serialize startup and recovery behind the cleanup promise, cancel in-flight retries when the engine stops or restarts, and keep duplicate recovery one-shot per engine start.

The public volatility scanner uses a separate WebSocket. Keep it warm with a ping every 25 seconds. On close, error, or a failed ping send, use bounded exponential retries, clear old timers and subscription IDs, then reload market histories to restore live subscriptions. Candidate selection should resume only from fresh scanning snapshots; reconnecting snapshots must not trigger work from stale rows.

**Why:** Long-running public scans can lose their socket, and without a heartbeat and re-subscription path the runner immediately reports an error. The authenticated trade feed has its own recovery and must not be restarted or duplicated just because the separate public scanner reconnects.

**How to apply:** Keep public-socket recovery inside the market scanner, preserve the active authenticated trade stream and contract locks, and reload public history before evaluating candidates after a disconnect.