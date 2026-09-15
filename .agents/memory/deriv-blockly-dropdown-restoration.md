---
name: Blockly dependent dropdown restoration
description: How uploaded DBot XML retains asynchronous market and trade selections.
---

Preserve the intended market, submarket, symbol, trade category, trade type, contract type, duration, and every purchase value from the XML before importing it. After the import guard is released, populate the market fields directly from the active-symbol service in parent-to-child order, then trigger the contract-type cascade. Keep restoration family-neutral: do not assume CALL/PUT, and do not require a duration block for families that omit one.

**Why:** Blockly validates dropdown values during import while API-backed menus can still contain only empty options. Waiting for those menus creates a circular dependency because parent-change events are what populate the child menus, and trade-type events are ignored while the import guard is active.

**How to apply:** Capture selections from the XML DOM, wait for the import guard and API helper, call each dropdown's option updater for Market → Submarket → Symbol, then restore Trade Category → Trade Type → Contract Type → Duration and every saved purchase field. Do not assume CALL/PUT or require a duration block for families that omit one. Validate XML enum values through Blockly code generation; visually loaded blocks can still disable Run when an enum is invalid.

**Why:** A callput-only reapply can silently replace digit or accumulator selections with defaults, while waiting for a missing duration block can prevent those families from restoring at all.

**How to apply:** Rebuild contract and purchase menus after restoring the trade family, then reapply saved values only after each menu contains the requested value. Skip duration polling when the imported bot has no duration selection.