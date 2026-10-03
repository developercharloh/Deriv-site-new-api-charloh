---
name: Rise/Fall bot isolation
description: Keep Rise/Fall workspace refreshes and Journal output isolated from other bots without changing trading behavior.
---

A saved Blockly workspace should only trigger the Rise/Fall template refresh when its saved name is `Rise_Fall_Master_Bot`; matching XML content alone can load Rise/Fall Journal blocks into another bot's builder view.

The shared Journal cache retains messages across bot switches. Smart Over 2 digit-window and condition analysis belongs in both Smart Over 2 and Rise/Fall MasterBot Journals, but not unrelated bots. ADX and Volatility Scan diagnostics are Rise/Fall-only. Never classify every `Smart Over 2 ·` row as Rise/Fall-only; tag new rows with the active bot scope. Preserve the Last-X numeric input's ability to accept Math Number blocks, and do not change the trade gate to fix a Journal display issue.

**Why:** The Smart Over 2 analysis helper is shared by both bots, so prefix-based filtering hid Smart Over 2's own Last-X and condition results. The user wants each bot's Journal behavior preserved while Rise/Fall-only diagnostics stay scoped.

**How to apply:** Emit and display shared Smart Over 2 analysis only for the matching active bot scope; keep ADX and Volatility Scan rows exclusive to Rise/Fall; retain unrelated bot Journal entries.