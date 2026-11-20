---
name: Binary Matrix bot scope
description: Preserve the XML bot while keeping the native adaptive runner removed
---

Keep the Binary Matrix XML bot and its Blockly execution path. The native adaptive scanner and standalone runner were removed at the user's request.

**Why:** The user explicitly asked to remove the native runner and leave the XML bot intact.

**How to apply:** Preserve the XML template, Blockly blocks, Builder loading, and generated trading behavior. Do not restore the native adaptive scanner or runner without an explicit request.
