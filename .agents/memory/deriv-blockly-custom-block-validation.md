---
name: Blockly custom block validation
description: Runtime validation rules for custom Blockly block definitions and generated code
---

Blockly's runtime `jsonInit` validates that every declared `args0` entry is referenced by a `%N` token in `message0`; a normal Rsbuild build will not catch missing or extra placeholders. A smoke test should instantiate each custom block with real Blockly and run the JavaScript generator. Custom value blocks must return `[code, operatorPrecedence]`; compile a connected condition-and-purchase workspace with `workspaceToCode`, not just a single block's text.

In isolated Jest workspaces, `javascriptGenerator.init(workspace)` may leave the legacy `Blockly.JavaScript.variableDB_` unset even though custom `variables_get` generators use it. Assign `javascriptGenerator.nameDB_` to that property before generating code that contains variables.

During XML-import preflight, count only active Blockly nodes: a `<shadow>` is a fallback and is not instantiated when the same input also contains a real `<block>`. Validate the real block's connection without treating the skipped shadow as a failed import.

**Why:** Valid Blockly XML may serialize both a shadow fallback and its replacement block, while the imported workspace contains only the real block. Counting both falsely rejects valid generated strategies.

**How to apply:** Exclude shadow nodes overridden by a direct block sibling in the same value or statement input from imported-node counts and ID checks; keep standalone shadows in validation.

**Why:** A production build can succeed while a malformed block or generator prevents a strategy from loading or running; standalone Jest workspaces can also leave the legacy variable database unset.

**How to apply:** When adding custom blocks, assert runtime initialization and generated `Bot.*` code. For Boolean/Number blocks, assert the tuple and generate a representative connected workspace before publishing. In Jest, initialize the legacy variable database before generating expressions with variable references.

Do not use a headless `Blockly.Workspace` to validate imported XML when custom mutation callbacks may call `this.initSvg()`. Use a temporary isolated `Blockly.inject` workspace for XML import checks, then dispose it and restore the active Deriv workspace reference.

**Why:** Blockly's rendered block methods are unavailable on headless blocks, so valid XML using mutator-backed inputs can fail preflight with `this.initSvg is not a function` before it reaches the real rendered workspace.

**How to apply:** Keep the validation workspace offscreen and read-only, disable Blockly events during import, and assert that it is disposed even when validation throws.