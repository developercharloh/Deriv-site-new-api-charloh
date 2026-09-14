---
name: Uploaded option blocks
description: Constraint for loading uploaded Deriv pattern-strategy XML in the Blockly builder.
---

Uploaded pattern-strategy XML may contain `variables_set_option` and `variables_is_option` blocks even though they are not stock Blockly blocks. Register those serialized types before importing the XML; otherwise Blockly can throw on the first root and leave only the default trade-definition canvas.

**Why:** The XML is valid and contains all three strategy roots, but Blockly aborts conversion when an unregistered custom type appears inside the first root. The resulting partial workspace looks like a mobile reveal problem even though the roots were never fully imported.

**How to apply:** Keep the uploaded XML strategy content unchanged and provide compatible variable assignment/comparison block definitions with mutation support for its option lists before calling `domToBlock`.