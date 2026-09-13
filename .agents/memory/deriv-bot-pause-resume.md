---
name: DBot pause and resume
description: Pause must preserve the interpreter and allow already-open contracts to settle
---

Pause is a live execution state, not a stop-and-restart. It blocks only before-purchase releases, stops the FAST slot clock, preserves the run state, and resumes the same interpreter; during-purchase settlement must continue while paused.

**Why:** Rebuilding the interpreter loses the current run and can reset strategy state, while blocking settlement can leave an open contract and lease unresolved.

**How to apply:** Keep Stop as the destructive action. Preserve the paused flag across trade-state transitions and ignore queued FAST re-arm signals until Resume starts a fresh slot.