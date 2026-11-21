---
name: Deriv toolbox test rendering
description: How Jest's React server-renderer mock affects tests that inspect the real Blockly toolbox.
---

When testing the full Bot Builder toolbox, render its React element tree into XML in the test rather than relying on the configured `react-dom/server` mock. The global mock returns a placeholder string with invalid XML attributes, so parsing it produces no categories or blocks.

**Why:** The catalog-size check must measure the actual current toolbox, not a mock fixture or empty catalog.

**How to apply:** Override the renderer only inside the focused test and restore its previous mock implementation afterward.
