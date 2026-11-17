---
name: Over/Under signal entry choice
description: Show Enter Now while indicators and the live feed qualify; 00:02 is a reference, not an automatic entry trigger.
---

The Over/Under source board shows Enter Now whenever the indicator setup is ready and its feed is fresh; do not gate it on 00:02 or `tradeNow`. The user chooses the entry moment. Clicking Enter Now opens #21's settings; confirming Save & Run starts #21 through DBot's standard Run handler on the connected account. Restore and verify the full Blockly dropdown chain, including both purchase choices, before starting.

**Why:** The user wants to decide when to enter (for example, at 00:05 or 00:49) once MACD/TSI conditions qualify, and specifically does not want the Enter Now control to appear only at 00:02. The 00:02 countdown is informational, not an automatic trigger. Confirming Save & Run can place a contract on the connected account. Blockly validates API-backed dropdown values during XML import, before their option lists may be ready.

**How to apply:** Keep indicator readiness separate from entry timing: require `setupReady` and a fresh live feed for Enter Now, but ignore `entryWindow` and `tradeNow` for visibility. Preserve the 00:02 timing reference and the existing explicit Save & Run confirmation.
