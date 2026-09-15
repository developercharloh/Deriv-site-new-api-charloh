---
name: Adaptive Momentum safety envelope
description: Safety and validation principles for the Adaptive Momentum Quick Strategy.
---

The Adaptive Momentum strategy must remain a signal qualifier, not a profitability claim: ambiguous or insufficient history produces `WAIT`, losses trigger a fresh-tick cooldown, and session profit/loss limits stop the generated bot before another purchase.

**Why:** Live market behavior has not been validated by replay or paper trading, so execution safety and honest user expectations matter more than optimizing entry frequency.

**How to apply:** Preserve the standard Quick Strategy → Blockly XML → TradeEngine path, keep risk controls in the generated XML, and require replay/demo validation before making claims about performance.