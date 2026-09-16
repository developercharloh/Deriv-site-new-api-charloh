---
name: Bot template refresh
description: How published Blockly bot templates interact with saved and open workspaces
---

Published XML is only the source for a newly loaded workspace. An already saved or open Blockly workspace retains its previous block tree and journal messages until the user explicitly loads the updated template into a fresh workspace.

**Why:** Automatically replacing a user's saved bot could destroy intentional edits and would not reliably remove stale blocks that caused an older runtime error.

**How to apply:** When changing a bot template, verify the served XML separately and tell users to open a fresh workspace or reload the template; do not promise that an existing workspace updated itself.