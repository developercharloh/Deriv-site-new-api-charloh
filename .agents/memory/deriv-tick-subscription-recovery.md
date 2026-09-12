---
name: Deriv tick subscription recovery
description: Deriv rejects duplicate live tick subscriptions for the same symbol on one WebSocket connection.
---

Deriv allows only one live tick subscription per symbol on a connection. A fast bot stop/start or another trading surface can leave the previous stream active briefly; recover by awaiting the connection API's `forgetAll('ticks')` cleanup before retrying the history subscription.

**Why:** Sending a new history request immediately after a local `forget` races Deriv's remote cleanup and produces `AlreadySubscribed`, leaving the bot showing as running while no qualifying ticks reach the strategy.

**How to apply:** Serialize startup and recovery behind the cleanup promise, cancel in-flight retries when the engine stops or restarts, and keep duplicate recovery one-shot per engine start.