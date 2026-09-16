---
name: Adaptive Momentum safety envelope
description: Safety and validation principles for the Adaptive Momentum Quick Strategy.
---

The reusable Adaptive Momentum strategy must remain a signal qualifier, not a profitability claim: ambiguous or insufficient history produces `WAIT`, and its own preset retains its safety gates. The Rise/Fall master bot does not invoke Adaptive Momentum; it calculates ADX, RSI, and MACD Histogram before entry, shows all three values in the purchase journal, and requires all three to confirm the CALL/PUT direction.

**Why:** Live market behavior has not been validated by replay or paper trading. The user explicitly required all three visible indicators to participate in the master-bot purchase decision instead of allowing a MACD-only gate.

**How to apply:** Preserve the standard Quick Strategy → Blockly XML → TradeEngine path. A master-bot CALL requires ADX `>= 20`, RSI `> 50`, and MACD histogram `> 0`; a PUT requires ADX `>= 20`, RSI `< 50`, and MACD histogram `< 0`; equality at the RSI/MACD boundaries or any disagreement must skip purchase. The journal entry should include ADX, RSI, and MACD Histogram values alongside model direction and confidence. After an authoritative loss, multiply the current stake immediately before the next trade cycle; do not add a warm-up or cooling reset. Do not add Adaptive Momentum blocks back to the master bot; changes to the reusable preset remain separate.