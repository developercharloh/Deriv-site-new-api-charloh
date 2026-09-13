---
name: SLOW browser regression timing
description: Timing constraint for deterministic repeated Binary Matrix browser checks.
---

The SLOW Binary Matrix browser check must keep emitting fresh mock ticks while the XML runner is in its re-analysis scan; a single delayed tick is race-prone and can leave the runner waiting even though the broker epoch advanced.

**Why:** The generated interpreter polls asynchronously after settlement, so a one-shot tick may arrive before its fresh-epoch guard is actively being checked.

**How to apply:** Drive the post-reset mock feed from the active polling lifecycle and stop it only after the next planned purchase or explicit harness stop. Keep real-account verification separate.