---
name: Rise/Fall template isolation
description: Saved Rise/Fall workspace refreshes must be scoped by workspace identity so they cannot replace another bot template.
---

A saved Blockly workspace should only trigger the Rise/Fall template refresh when its saved name is `Rise_Fall_Master_Bot`; matching XML content alone can load Rise/Fall Journal blocks into another bot's builder view.

**Why:** The builder's recent-workspace startup path handled a stale Rise/Fall-shaped XML without checking which bot the workspace belonged to, creating cross-template contamination.

**How to apply:** Keep bot-template refresh rules scoped to the saved workspace name or an equally explicit bot identity, and add a regression assertion for templates that must not contain another bot's variables.