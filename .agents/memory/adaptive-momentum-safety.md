---
name: Adaptive Momentum safety envelope
description: Safety and validation principles for the Adaptive Momentum Quick Strategy.
---

The Adaptive Momentum strategy must remain a signal qualifier, not a profitability claim: ambiguous or insufficient history produces `WAIT`, and the generated bot treats Adaptive Momentum as informational once the primary model is directional. The Rise/Fall master bot's purchase-block gate was explicitly removed from its Blockly XML; the reusable Adaptive Momentum preset still retains its own safety gates.

**Why:** Live market behavior has not been validated by replay or paper trading, but the user explicitly chose to remove the master bot's blocking purchase conditions rather than bypass them in generated code.

**How to apply:** Preserve the standard Quick Strategy → Blockly XML → TradeEngine path. Do not restore the removed master-bot purchase gate or reintroduce its payout/indicator/risk blocks as automatic vetoes without explicit user direction. Adaptive `CALL`/`PUT` disagreement and `WAIT` remain diagnostic states; primary `WAIT` still cannot purchase.