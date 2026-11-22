---
name: AI Analysis entry patterns
description: User expectations for Wide Eye Over/Under, Even/Odd, and Rise/Fall signals
---

Use the selected Over/Under barrier to classify recent last digits: Over is a last digit above the barrier, Under is below it, and equality is neither. Valid Over barriers are 0–8; valid Under barriers are 1–9. Compute both percentages against the full last-X tick window and report the at-barrier share separately.

Even/Odd comes from the final decimal digit. Rise/Fall comes from comparing consecutive prices; a flat comparison is neither. The displayed patterns are advisory entry-point signals only and must never start trades automatically.

The Over/Under entry pattern currently reuses the nine-step Rise/Fall shape, translating R to Ov and F to U.

**Why:** The user asked for explicit barrier-based symbol streams and percentages, correct even/odd classification, recent Rise/Fall, and non-automatic entry signals. No separate Over/Under target pattern was supplied, so the implementation reuses the existing nine-step binary pattern shape.

**How to apply:** Keep the selected barrier and tick window consistent across Normal and Wide Eye cards. If the user supplies a dedicated Over/Under target sequence, replace the derived shape without changing digit classification or percentage semantics.
