---
name: Apex AI Builder visibility
description: Verification guidance for blank Builder reports on ACCESS Bot #5.
---

For blank Builder reports on ACCESS Bot #5 (Apex AI), verify the Free Bots path against the actual `Apex_AI.xml` template and preserve its Virtual Hook strategy behavior. On narrow viewports, normalize the roots and leave Blockly at the workspace origin; do not center the tall `trade_definition` root.

**Why:** A signed-in mobile screenshot showed a blank canvas with Blockly's vertical scrollbar partway down after root-centering was deployed. Centering the tall root overrode the mobile scroll reset, so a passing XML-import test alone did not catch the visible failure.

**How to apply:** Keep the viewport-origin reset for mobile and limit root-centering to desktop. Test the catalog mapping, actual template import, and that mobile reveal calls `workspace.scroll(0, 0)` without calling `centerOnBlock`; do not claim headless tests prove signed-in UI visibility.
