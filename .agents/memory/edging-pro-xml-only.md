---
name: Edging pro XML-only delivery
description: The required product shape and release constraint for Edging pro in this app.
---

Edging pro must remain a DBot XML/Blockly bot in Free Bots → Edging Bots, not a standalone native runner or modal. It may use registered custom Blockly blocks when they are functional through the ordinary Builder run controls. Do not publish a replacement without explicit user approval.

**Why:** The user corrected the prior native-only approach and explicitly requested an XML bot with functional custom blocks, registered in the DBot block menu.

**How to apply:** Keep the Free Bots XML load path and toolbox entry as the user-facing workflow. Before replacing a published Edging pro version, obtain approval to publish.