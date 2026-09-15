---
name: Blockly dependent dropdown restoration
description: How uploaded DBot XML retains asynchronous market and trade selections.
---

Preserve the intended market, submarket, symbol, trade category, trade type, and duration values from the XML before importing it. After Deriv API options arrive, restore the dependent fields in parent-to-child order and trigger each normal Blockly change cascade.

**Why:** Blockly validates dropdown values during import while the API-backed menus can still contain only empty options. Once rejected, reading the workspace afterward returns blanks, so a late repair cannot recover the original XML selections. Repairing only duration and purchase fields leaves the market chain visibly blank.

**How to apply:** Any direct Free Bots or uploaded-XML loader must capture selections from the XML DOM first, wait for each exact option, restore Market → Submarket → Symbol → Trade Category → Trade Type, and only then restore duration and purchase fields.