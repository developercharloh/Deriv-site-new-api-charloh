---
name: Even Odd Strike Eagle Virtual Hook
description: User-defined lifecycle and boundaries for the bot's Even/Odd-only Virtual Hook.
---

For Even Odd Strike Eagle, “Switch After” controls both the consecutive virtual-loss threshold and the number of settled real contracts traded per side. A virtual win resets the loss streak. After X consecutive virtual losses, the bot trades that side live for X real contracts, then switches sides. Virtual contracts do not count as real trades or affect stake, Martingale, or real-trade risk checks. The bot supports only Even/Odd; do not add Over/Under or Rise/Fall branches.

**Why:** The user supplied the exact specification and requested a single-mode replacement for the removed multi-strategy bot.

**How to apply:** Preserve the per-side pre-purchase gate and shared “Switch After” threshold whenever changing this bot.
