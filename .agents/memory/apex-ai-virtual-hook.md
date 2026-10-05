---
name: Apex AI Virtual Hook
description: User-confirmed lifecycle for the Apex AI bot's Even/Odd Virtual Hook.
---

For Apex AI's Even/Odd mode, the existing Switch After X value controls both the required consecutive virtual losses and the number of live contracts traded per side. A virtual win resets the loss streak. After X consecutive virtual losses, the bot trades that side live for X contracts, then the existing A/B side-switch logic advances. Virtual contracts do not count as live trades or change stake and risk-control behavior. Keep Over/Under and Rise/Fall routes unchanged unless asked.

**Why:** The user confirmed this cycle and asked to keep the other Apex AI modes unchanged.

**How to apply:** Preserve the per-side pre-purchase gate and the shared Switch After X threshold when changing Apex AI's Even/Odd strategy.
