---
name: Even Odd Strike Eagle Builder visibility
description: Verification guidance for blank mobile Builder reports on premium Bot #5.
---

For blank Builder reports on Bot #5 — Even Odd Strike Eagle, verify the premium catalog path against the `Even_Odd_Strike_Eagle.xml` template and preserve its Even/Odd-only Virtual Hook behavior. Run-preflight messages for missing required blocks mean the workspace lacks those blocks; they are not just offscreen. Use Blockly's whole-workspace XML import for this template, validate its required roots and strategy blocks before reporting success, and send failures to the Builder Journal because the catalog card unmounts during navigation. The card loader must wait until Blockly initialization finishes, not just until its SVG mounts. On narrow viewports, normalize the roots and leave Blockly at the workspace origin; do not center a tall trade-definition root.

The loader rehydrates API-backed dropdowns after XML import. Keep post-load event handling synchronized with the lifecycle guards for mandatory root blocks and the load-event checks in dependent field handlers; otherwise Blockly can process restoration like a user edit and reset fields or prune required blocks.

**Why:** The signed-in mobile report still showed missing-root preflight errors after scroll fixes; the prior per-root import test did not verify the production whole-workspace path. A headless template-import test cannot prove that the authenticated mobile UI renders correctly.

**How to apply:** Test catalog mapping, the whole-workspace template import, required-block validation, load-aware field restoration, loader readiness after Blockly initialization, and mobile reveal at the workspace origin without `centerOnBlock`. Do not claim headless tests prove signed-in UI visibility.
