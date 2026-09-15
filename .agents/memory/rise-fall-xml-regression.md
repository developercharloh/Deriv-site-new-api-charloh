---
name: Rise/Fall XML regression
description: How to validate the bundled Rise/Fall Blockly strategy without broker or editor runtime state
---

The Rise/Fall Master Bot regression should import the complete XML with every production block definition registered, then generate the imported safety-gate condition directly. Full-workspace generation invokes trade-definition broker state and custom Journal blocks that are only valid inside the live editor.

**Why:** A plain XML parser misses Blockly mutation/input problems, while a full headless workspace generator fails for unrelated authentication and SVG/editor hooks. The split catches malformed or unregistered strategy blocks without coupling the test to a logged-in broker.

**How to apply:** Keep the test’s production block imports and headless rendering stubs aligned with the editor. Treat dependent-dropdown warnings as expected until live market options are hydrated; failures to import the XML or generate the gate condition are real regressions.