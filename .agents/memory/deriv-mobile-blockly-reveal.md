---
name: Mobile Blockly reveal
description: The reliable way to anchor imported long Blockly strategies at the mobile workspace origin
---

After importing a long strategy on a narrow viewport, normalize the top-level roots and reset the Blockly workspace with `workspace.scroll(0, 0)`. Setting `ScrollbarPair` handles to zero is not equivalent: scrollbar setters take handle ratios, and a later resize can leave the workspace translation hundreds of pixels below the visible toolbar.

Treat a narrow viewport as mobile even when the device flag still reports desktop during initial workspace setup.

**Why:** A loaded strategy can have correct root coordinates while still rendering below the viewport because Blockly's absolute `scrollX` and `scrollY` remain offset. A stale desktop flag can also skip mobile reveal on a phone-width viewport. Repeated reveal calls are useful while async dropdowns settle, but each call must reset the workspace translation directly.

**How to apply:** Gate mobile reveal on either the device flag or a narrow viewport. Keep the full strategy layout and scale intact; move only the top-level origin on mobile, then call `svgResize`, scrollbar resize, and `workspace.scroll(0, 0)` in that order.