---
name: Apex AI Builder visibility
description: Verification guidance for blank Builder reports on ACCESS Bot #5.
---

For blank Builder reports on ACCESS Bot #5 (Apex AI), verify the Free Bots path against the actual `Apex_AI.xml` template and focus its `trade_definition` root after loading. Generic startup XML checks are insufficient. Preserve Apex AI's Virtual Hook strategy behavior.

**Why:** A generic workspace change and deployment did not resolve the Apex-specific blank-canvas report. The actual Apex XML imports in headless Blockly and includes procedure and Virtual Hook roots, but an anonymous preview cannot verify the signed-in rendered canvas.

**How to apply:** Keep visibility changes scoped to Apex unless evidence supports a broader fix. Test the catalog mapping, actual template import, and root-targeted reveal; do not claim headless import as proof of signed-in UI visibility.
