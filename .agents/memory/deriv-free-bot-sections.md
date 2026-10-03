---
name: Free Bot section classification
description: Product rule for assigning Free Bots to sections based on their Blockly template blocks.
---

Classify Free Bots that use registered custom Blockly blocks as **Premium Bots**. Classify templates without custom blocks as **Smart Contract Bots**. There are currently no **Edging Bots**.

**Why:** The user explicitly set this classification for the Free Bots catalog.

**How to apply:** When adding or changing a Free Bot template, inspect its XML against the custom Blockly block registry before assigning its section.