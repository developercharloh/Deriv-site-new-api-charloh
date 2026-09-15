---
name: Alpha Scan risk regression
description: Durable browser-regression assertions for automatic session risk limits.
---

Automatic-runner boundary fixtures should assert the execution leg is idle, the active-contract rows are empty, and a dedicated completed-trade counter reaches the configured boundary.

**Why:** Feedback text can be replaced by the next automatic cycle, and the visible trade journal intentionally keeps only a limited number of rows, so neither is a reliable measure of a completed session.

**How to apply:** Keep stop-reason text assertions for user-visible behavior, but use durable state and an uncapped fixture-only counter for completion and no-orphan checks.