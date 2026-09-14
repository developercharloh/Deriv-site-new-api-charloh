---
name: Uploaded option blocks
description: Constraint for loading uploaded Deriv pattern-strategy XML in the Blockly builder.
---

Uploaded pattern-strategy XML may contain custom serialized blocks such as `variables_set_option`, `variables_is_option`, `even_odd_analysis`, and `apollo_notify` even though they are not stock Blockly blocks. Register those types before importing the XML; otherwise Blockly can throw on the first root and leave only the default trade-definition canvas.

**Why:** The XML is valid and contains all three strategy roots, but Blockly aborts conversion when an unregistered custom type appears inside the first root. The resulting partial workspace looks like a mobile reveal problem even though the roots were never fully imported.

**How to apply:** Keep uploaded XML strategy content unchanged and provide compatible block definitions and generators before calling `domToBlock`; expose them in the Analysis Logics toolbox when users should be able to add the blocks manually.