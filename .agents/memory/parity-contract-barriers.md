---
name: Parity contract barriers
description: Deriv API requirements for parity contract purchase payloads
---

Parity contracts are barrierless. DIGITEVEN and DIGITODD must not receive a prediction, selected_tick, or barrier field, even if an uploaded Blockly strategy passes a numeric value through a shared purchase block. DIGITOVER and DIGITUNDER retain their numeric barriers.

**Why:** Deriv rejects parity purchases that include a numeric barrier, so the bot can correctly qualify a signal but still fail before creating a transaction.

**How to apply:** Enforce the rule in both the generated purchase options and the final proposal/buy request builders. Keep the visible mapping label as Even or Odd without a prediction value.