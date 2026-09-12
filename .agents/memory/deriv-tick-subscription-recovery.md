---
name: Deriv tick subscription recovery
description: Deriv rejects duplicate live tick subscriptions for the same symbol on one WebSocket connection.
---

Deriv allows only one live tick subscription per symbol on a connection. A fast bot stop/start or another trading surface can leave the previous stream active briefly; recover by clearing tick streams once with `forget_all: 'ticks'`, then retrying the history subscription.

**Why:** A stale subscription otherwise leaves the bot showing as running while no qualifying ticks reach the strategy, so it never reaches the proposal or buy path.

**How to apply:** Keep recovery one-shot per engine start, retry after a short delay, and fail clearly if the second subscription is also rejected.