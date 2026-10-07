---
name: Even Odd Strike Eagle Builder visibility
description: Verification guidance for blank mobile Builder reports on premium Bot #5.
---

For blank Builder reports on Bot #5 — Even Odd Strike Eagle, verify the premium catalog path against the `Even_Odd_Strike_Eagle.xml` template and preserve its Even/Odd-only Virtual Hook behavior. Run-preflight messages for missing required blocks mean the workspace lacks those blocks; they are not just offscreen. Use Blockly's whole-workspace XML import for this template, validate its required roots and strategy blocks before reporting success, and send failures to the Builder Journal because the catalog card unmounts during navigation. The card loader must wait until Blockly initialization finishes, not just until its SVG mounts. On narrow viewports, normalize the roots and leave Blockly at the workspace origin; do not center a tall trade-definition root.

The loader rehydrates API-backed dropdowns after XML import. Keep post-load event handling synchronized with the lifecycle guards for mandatory root blocks and the load-event checks in dependent field handlers; otherwise Blockly can process restoration like a user edit and reset fields or prune required blocks.

For Blockly custom blocks, call `modifyContextMenu(menu)` only from `customContextMenu(menu)`, not from `init()` with `this`. SVG block initialization during XML import does not pass a menu array; using the block instance as one aborts the import. Headless imports do not exercise this lifecycle.

Strike Eagle has separate editable Run once values: `Consecutive VH Losses` gates live entry after X consecutive virtual losses, while `Switch After` counts live wins before changing sides. Live losses neither count toward the win target nor return the bot to virtual trades; changing sides starts a fresh virtual-loss streak.

**Why:** The user clarified that the virtual-loss gate and live-win side-switch target must be independently configurable.

**How to apply:** Keep both settings in Run once; wire the Virtual Hook setup to `Consecutive VH Losses`, compare the win-only side counter to `Switch After`, and restart virtual qualification after each side change.

**Why:** The signed-in mobile report still showed missing-root preflight errors after scroll fixes; the prior per-root import test did not verify the production whole-workspace path. A headless template-import test cannot prove that the authenticated mobile UI renders correctly.

**How to apply:** Test catalog mapping, the whole-workspace template import, required-block validation, load-aware field restoration, loader readiness after Blockly initialization, and mobile reveal at the workspace origin without `centerOnBlock`. Do not claim headless tests prove signed-in UI visibility.

**Why:** The real mobile failure came from a custom context-menu helper receiving a block instance while Blockly initialized SVG blocks; only a mobile browser import reproduced it.

**How to apply:** Keep an SVG/mobile browser regression for this template and verify all rendered roots and serialized blocks, not only the headless XML model.
