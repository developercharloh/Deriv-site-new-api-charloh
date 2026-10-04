---
name: Smart Over 2 Turbo queue freshness
description: Queue freshness and shared-gate invariants for coordinated Smart Over 2 Turbo entries
---

Coordinate only recognized Smart Over 2 FAST workspaces through the shared FIFO contract gate. Expire queued intent when the observed market tick changes, not when the 300 ms FAST scheduler slot advances; the scheduler slot is cadence, not market-signal freshness. After a waiter receives the gate, reread staged entry/recovery plans and refresh matching proposals before buying. Pause cancels only queued entries, while open contracts remain free to settle. Keep existing risk and Martingale rules unchanged.

**Why:** A queued runner must not buy a signal that expired while another order was active, but clock slots are not themselves market signals. Shared serialization reduces overlapping automated orders; it cannot remove broker or network latency.

**How to apply:** When changing Smart Over 2 Turbo coordination, preserve FIFO ordering, validate at grant and immediately before sending the buy, and do not describe the existing 300 ms Fast cadence as a guaranteed order interval.