---
name: Bot template refresh
description: How published Blockly bot templates interact with saved and open workspaces
---

Published XML is only the source for a newly loaded workspace. An already saved or open Blockly workspace retains its previous block tree and journal messages until the user explicitly loads the updated template into a fresh workspace.

When editing chained Blockly XML, check both that it parses and that important blocks remain under the intended statement; well-formed XML can still place a startup setting outside `INITIALIZATION`.

**Why:** Automatically replacing a user's saved bot could destroy intentional edits, and nested `next` wrappers can preserve valid XML while putting a setting in the wrong execution section.

**How to apply:** When changing a bot template, verify the served XML separately, assert important block placement and field defaults, and tell users to open a fresh workspace or reload the template; do not promise that an existing workspace updated itself.