---
name: Blockly payout gate
description: How payout floors are represented by the existing Blockly safety gate.
---

Use the live `payout` block and the configured stake as inputs to `payout_gate`; do not use a fixed numeric payout placeholder. The existing gate accepts a required break-even win-rate percentage, so a minimum total payout of 1.60x stake corresponds to a 62.5% threshold.

**Why:** The gate computes stake divided by payout. A fixed payout value can make the guard pass or fail independently of the actual broker proposal and does not enforce a meaningful multiplier.

**How to apply:** Restore the payout block’s dependent purchase dropdown after XML import, and keep the gate inside the bot’s before-purchase safety chain alongside no-active-contract and loss/session limits.