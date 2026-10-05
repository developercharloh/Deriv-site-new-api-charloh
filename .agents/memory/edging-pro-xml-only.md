---
name: Edging pro XML-only delivery
description: The required product shape and release constraint for Edging pro in this app.
---

Edging pro must remain a DBot XML/Blockly bot in Free Bots → Edging Bots, not a standalone native runner or modal. Its settings belong under Run once at start and its entry condition belongs under Purchase conditions. Each entry must open exactly two one-tick contracts: Digit Over 5 and Digit Under 4; replaying the same broker tick must not create another pair. Settled virtual-pair wins and losses should appear in account-wide Transactions without affecting real-trade statistics or P/L; persistence must not depend on the Journal’s currently selected bot scope. Its analysis row must refresh on each newer tick epoch even if the broker repeats a tick ID; suppress only an exact duplicate event. Do not publish a replacement without explicit user approval.

**Why:** The user corrected the prior native-only approach, explicitly requested functional XML custom blocks, and reported detached settings, missing virtual Transactions rows, four contracts opening instead of the intended pair, and a stale last-digit Journal row. Journal selection is a display filter, not an account-history filter; tick-ID-only deduplication can hide newer epochs if IDs repeat.

**How to apply:** Keep the Free Bots XML load path and toolbox entries as the user-facing workflow; verify exact pair composition, duplicate-tick protection, account-wide settlement routing, and same-ID/new-epoch analysis updates in focused tests. Include the epoch in analysis tick identity. Before replacing a published Edging pro version, obtain approval to publish.

Once the Virtual Hook threshold is met, allow at most one paid Over 5 + Under 4 pair during an uninterrupted Last-X qualification streak. Do not interpret each later qualifying tick as a new paid entry; rearm only after the condition becomes NOT MET. Keep virtual pairs available to accumulate the threshold before that live pair.

**Why:** the user reported four paid contracts where one pair was intended; the runner had opened another paid pair on a later tick while the same entry condition remained MET.

**How to apply:** test exactly two paid contracts for one qualifying streak, no additional paid pair across later MET ticks, and a fresh pair only after a nonqualifying tick resets the streak.