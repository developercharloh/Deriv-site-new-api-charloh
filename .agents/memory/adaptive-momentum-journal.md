---
name: Adaptive Momentum journaling
description: Durable Journal behavior for Adaptive Momentum analysis and trade lifecycle events
---

Adaptive Momentum Journal output should refresh a single analysis-status row instead of creating one row per broker tick. Signal decisions, skipped entries, confirmed entry ticks, settlements, and risk-stop reasons should remain separate event rows.

**Why:** The strategy can evaluate on every tick; preserving every raw analysis as a new row makes the Journal noisy and obscures the trade lifecycle.

**How to apply:** Keep analysis telemetry grouped and current, while preserving discrete decision and execution events as the readable audit trail.