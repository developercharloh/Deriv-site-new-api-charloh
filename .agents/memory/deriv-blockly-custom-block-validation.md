---
name: Blockly custom block validation
description: Runtime validation rules for custom Blockly block definitions and generated code
---

Blockly's runtime `jsonInit` validates that every declared `args0` entry is referenced by a `%N` token in `message0`; a normal Rsbuild build will not catch missing or extra placeholders. A smoke test should instantiate each custom block with real Blockly and run the JavaScript generator.

**Why:** A production build can succeed while a user dragging one malformed block into the workspace throws immediately, preventing the bot from loading.

**How to apply:** When adding custom blocks, include the block in the runtime smoke suite and assert both initialization and generated `Bot.*` code before publishing.