---
name: Rise/Fall bot isolation
description: Keep Rise/Fall workspace refreshes and Journal output isolated from other bots without changing trading behavior.
---

A saved Blockly workspace should only trigger the Rise/Fall template refresh when its saved name is `Rise_Fall_Master_Bot`; matching XML content alone can load Rise/Fall Journal blocks into another bot's builder view.

The shared Journal cache retains messages across bot switches. Tag entries with their source bot and hide Rise/Fall-specific rows while another bot is active; do not clear shared history or alter unrelated bots' Journal entries. Preserve the Last-X numeric input's ability to accept Math Number blocks, and do not add a trade gate or report-only step to solve a Journal display issue.

**Why:** The builder's recent-workspace startup path and shared Journal view both allowed Rise/Fall content to cross bot boundaries. The user explicitly wants the Journal scoped to its bot while keeping existing trading logic unchanged.

**How to apply:** Scope template refreshes and Journal visibility to the active bot identity, keep the shared Journal data intact, and test that Rise/Fall-only rows disappear in another bot while that bot's own rows remain visible.