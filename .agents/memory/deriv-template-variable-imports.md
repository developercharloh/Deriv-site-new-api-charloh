---
name: Blockly template variable imports
description: Correct XML node selection when manually importing Blockly variables into a workspace.
---

Pass the `<variables>` element itself to `Blockly.Xml.domToVariables`; do not pass the document's `<xml>` root.

**Why:** `domToVariables` iterates the argument's direct children as variable declarations. With the whole document, root blocks are treated as variables, creating bogus names and ID conflicts that can abort import before any roots load.

**How to apply:** For manual template imports, find the direct `<variables>` child and import its contents before importing the root blocks. Keep a browser regression that switches between templates with serialized variables and confirms roots remain visible.