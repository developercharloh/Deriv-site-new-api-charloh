---
name: AI Analysis entry patterns
description: User expectations for Wide Eye Over/Under, Even/Odd, and Rise/Fall signals
---

Use the selected Over/Under barrier to classify recent last digits: Over is a last digit above the barrier, Under is below it, and equality is neither. Valid Over barriers are 0–8; valid Under barriers are 1–9. Compute both percentages against the full last-X tick window and report the at-barrier share separately.

Even/Odd comes from the final decimal digit. Rise/Fall comes from comparing consecutive prices; a flat comparison is neither. The displayed patterns are advisory entry-point signals only and must never start trades automatically.

The Over/Under entry pattern reuses the nine-step Rise/Fall shape, translating R to Ov and F to U; the user confirmed this target. In the live UI, show only the actual recent classifications; do not display the target pattern or a "Wait" state when it does not match. Keep an "Entry" label only when the live sequence matches.

Do not display the explanatory Over/Under barrier-range caption. Keep the barrier selector and selected-barrier readings without the 0–8 / 1–9 range text.

**Why:** The user asked for explicit barrier-based symbol streams and percentages, correct even/odd classification, recent Rise/Fall, and non-automatic entry signals, then clarified that target/wait labels and the barrier-range caption obscure the actual movement.

**How to apply:** Keep the selected barrier and tick window consistent across Normal and Wide Eye cards. Render live `Ov`/`U`, `E`/`O`, and `R`/`F` movement streams without target or no-match labels. If a sequence matches the confirmed shape, the Entry label can remain.
