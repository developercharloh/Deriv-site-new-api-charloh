---
name: Apex AI Builder visibility
description: Verification guidance for blank Builder reports on ACCESS Bot #5.
---

For blank Builder reports on Bot #5 — Apex AI Multi-Strategy Bot (ACCESS Bot #5), verify the Free Bots path against the actual `Apex_AI.xml` template and preserve its Virtual Hook strategy behavior. The card loader must wait until Blockly initialization finishes, not just until its SVG mounts. On narrow viewports, normalize the roots and leave Blockly at the workspace origin; do not center the tall `trade_definition` root.

The loader rehydrates API-backed dropdowns after XML import. Keep that post-load event group synchronized with the lifecycle guards for `trade_definition`, `before_purchase`, and `trade_definition_tradeoptions`, and with the load-event checks in contract-type, multiplier, and accumulator handlers; otherwise Blockly can process restoration like a user edit and reset fields or prune required blocks.

**Why:** The signed-in mobile report persisted after scroll/readiness changes. Code inspection found that late dropdown restoration and mandatory-root guards used different event groups. A headless Apex import test checks the guarded post-load path, but does not prove the authenticated mobile UI renders correctly.

**How to apply:** Test catalog mapping, actual template import, root-block guards, load-aware field restoration, loader readiness after the store exits loading, and mobile reveal at the workspace origin without `centerOnBlock`. Do not claim headless tests prove signed-in UI visibility.
