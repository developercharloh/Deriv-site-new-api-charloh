---
name: Blockly dependent dropdown restoration
description: How uploaded DBot XML retains asynchronous market and trade selections.
---

Preserve the intended market, submarket, symbol, trade category, trade type, and duration values from the XML before importing it. After the import guard is released, populate the market fields directly from the active-symbol service in parent-to-child order, then trigger the contract-type cascade.

**Why:** Blockly validates dropdown values during import while API-backed menus can still contain only empty options. Waiting for those menus creates a circular dependency because parent-change events are what populate the child menus, and trade-type events are ignored while the import guard is active.

**How to apply:** Capture selections from the XML DOM, wait for the import guard and API helper, call each dropdown's option updater for Market → Submarket → Symbol, then restore Trade Category → Trade Type → Duration and purchase fields. Validate XML enum values through Blockly code generation; visually loaded blocks can still disable Run when an enum is invalid.