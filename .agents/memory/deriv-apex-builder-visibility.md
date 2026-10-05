---
name: Apex AI Builder visibility
description: Verification guidance for blank Builder reports on ACCESS Bot #5.
---

For blank Builder reports on Bot #5 — Apex AI Multi-Strategy Bot (ACCESS Bot #5), verify the Free Bots path against the actual `Apex_AI.xml` template and preserve its Virtual Hook strategy behavior. The card loader must wait until Blockly initialization finishes, not just until its SVG mounts. On narrow viewports, normalize the roots and leave Blockly at the workspace origin; do not center the tall `trade_definition` root.

**Why:** A signed-in mobile screenshot stayed blank after the first scroll correction. The Free Bots loader can observe Blockly's injected SVG before the store reports initialization complete, creating a race with the initial workspace restore. Centering the tall root also overrides the mobile scroll reset.

**How to apply:** Test catalog mapping, actual template import, loader readiness after the store exits loading, and mobile reveal at the workspace origin without `centerOnBlock`. Do not claim headless tests prove signed-in UI visibility.
