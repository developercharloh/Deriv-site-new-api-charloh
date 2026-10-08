---
name: Blockly custom block validation
description: Runtime validation rules for custom Blockly block definitions and generated code
---

Blockly's runtime `jsonInit` validates that every declared `args0` entry is referenced by a `%N` token in `message0`; a normal Rsbuild build will not catch missing or extra placeholders. A smoke test should instantiate each custom block with real Blockly and run the JavaScript generator. Custom value blocks must return `[code, operatorPrecedence]`; compile a connected condition-and-purchase workspace with `workspaceToCode`, not just a single block's text.

In isolated Jest workspaces, `javascriptGenerator.init(workspace)` may leave the legacy `Blockly.JavaScript.variableDB_` unset even though custom `variables_get` generators use it. Assign `javascriptGenerator.nameDB_` to that property before generating code that contains variables.

**Why:** A production build can succeed while a malformed block or generator prevents a strategy from loading or running; standalone Jest workspaces can also leave the legacy variable database unset.

**How to apply:** When adding custom blocks, assert runtime initialization and generated `Bot.*` code. For Boolean/Number blocks, assert the tuple and generate a representative connected workspace before publishing. In Jest, initialize the legacy variable database before generating expressions with variable references.