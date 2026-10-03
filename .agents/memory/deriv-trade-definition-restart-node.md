---
name: Blockly trade-definition restart node
description: Required restart-on-error child for Deriv DBot trade-definition XML.
---

New `trade_definition` XML should include a `trade_definition_restartonerror` child with a `RESTARTONERROR` field. Older saved workspaces may not have it, so the generator must treat a missing child as the existing default (`RESTARTONERROR` enabled) rather than dereferencing it.

**Why:** A custom bot template omitted the standard child and produced a Journal error before the strategy could run; template updates do not rewrite already saved workspaces.

**How to apply:** Preserve both restart settings in new bot XML, null-check optional children in the trade-definition generator, and test an older workspace with the restart-on-error child removed.