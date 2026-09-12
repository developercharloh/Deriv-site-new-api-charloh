---
name: Binary Matrix stake settings
description: Reading configured Binary Matrix values from Blockly variable blocks
---

Binary Matrix Builder settings must resolve a Blockly variable field's internal ID to its variable model name before reading the numeric child block; matching the visible text directly can silently select the fallback stake.

**Why:** Blockly stores `variables_set.VAR` as an ID even though the Builder displays the variable name. A direct name comparison caused a visible stake of 50 to execute as the native runner's 0.5 fallback.

**How to apply:** Resolve by `getVariableById` or the variable map, then read the `VALUE` input and keep a regression for a non-default visible stake.