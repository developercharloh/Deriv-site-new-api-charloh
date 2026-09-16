---
name: Adaptive Momentum safety envelope
description: Safety and validation principles for the Adaptive Momentum Quick Strategy.
---

The Adaptive Momentum strategy must remain a signal qualifier, not a profitability claim: ambiguous or insufficient history produces `WAIT`, and the generated bot treats Adaptive Momentum as informational once the primary model is directional. The Rise/Fall master bot calculates ADX and RSI for analysis and uses MACD histogram direction as the explicit CALL/PUT purchase gate; the reusable Adaptive Momentum preset retains its own safety gates.

**Why:** Live market behavior has not been validated by replay or paper trading. The user later explicitly required MACD histogram direction to prevent the master bot from buying immediately on the primary model signal.

**How to apply:** Preserve the standard Quick Strategy → Blockly XML → TradeEngine path. A master-bot CALL requires MACD histogram `> 0`; a PUT requires histogram `< 0`; zero or disagreement must skip purchase. After an authoritative loss, multiply the current stake immediately before the next trade cycle; do not add a warm-up or cooling reset. Keep ADX and RSI informational unless the user explicitly requests additional gates. Adaptive `CALL`/`PUT` disagreement and `WAIT` remain diagnostic states; primary `WAIT` still cannot purchase.