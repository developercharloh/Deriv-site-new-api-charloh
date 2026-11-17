---
name: Over/Under Builder template sharing
description: Keep Premium indicator setup isolated from the legacy signal-driven Over/Under bot.
---

The Premium indicator bot is configured in memory before its Blockly XML is loaded into standard DBot Builder. Do not rewrite the shared source template for this setup: the legacy signal-driven Over/Under bot still relies on its original scan-and-enter flow.

**Why:** Both catalog entries share one XML source, and changing that source would silently alter the legacy bot.

**How to apply:** Apply Premium indicator and risk settings only in the Premium load path; leave the legacy signal bot's source XML and scanner logic unchanged.
