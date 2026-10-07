---
name: Even Odd Strike Eagle Virtual Hook
description: User-defined lifecycle and boundaries for the bot's Even/Odd-only Virtual Hook.
---

For Even Odd Strike Eagle, `Consecutive VH Losses` controls the consecutive virtual-loss gate and `Switch After` independently sets the number of live wins required before changing sides. A virtual win resets the loss streak. After X consecutive virtual losses, the bot trades that side live until X wins have settled; live losses do not count or return to the Virtual Hook. Switching sides starts a fresh virtual streak. Virtual contracts do not count as real trades or affect stake, Martingale, or real-trade risk checks. The bot supports only Even/Odd; do not add Over/Under or Rise/Fall branches.

**Why:** The user clarified that the virtual-loss threshold and live-win switch count must be separate settings after reviewing actual trade behavior.

**How to apply:** Preserve the per-side pre-purchase gate, separate Run once values, and win-only side-switch counter whenever changing this bot.
