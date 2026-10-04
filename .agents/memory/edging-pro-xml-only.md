---
name: Edging pro XML-only delivery
description: The required product shape and release constraint for Edging pro in this app.
---

Edging pro must remain a DBot XML/Blockly bot in Free Bots → Edging Bots, not a standalone native runner or modal. Its settings belong under Run once at start and its entry condition belongs under Purchase conditions. Settled virtual-pair wins and losses should appear in Transactions like Smart Over 2, without affecting real-trade statistics or P/L. Do not publish a replacement without explicit user approval.

**Why:** The user corrected the prior native-only approach, explicitly requested functional XML custom blocks, and later reported that the settings were detached and virtual outcomes were missing from Transactions.

**How to apply:** Keep the Free Bots XML load path and toolbox entries as the user-facing workflow. Before replacing a published Edging pro version, obtain approval to publish.