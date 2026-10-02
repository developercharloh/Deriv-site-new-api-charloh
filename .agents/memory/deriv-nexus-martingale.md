---
name: Nexus Martingale behavior
description: User-selected stake progression and scope for Nexus AI.
---

In Nexus AI, Martingale is independent of the recovery-market toggle. When enabled, consecutive losses multiply the base stake by the selected factor; a win resets the next stake to base. Keep the feature limited to Nexus AI, and retain the session stop-loss budget guard.

**Why:** The user selected Nexus AI and chose the interpretation that Martingale controls stake progression while Recovery controls the alternate recovery market.

**How to apply:** When changing Nexus trade sizing or recovery behavior, preserve this separation and verify progression with Recovery off, as well as the base-stake fallback when the requested stake exceeds the remaining stop-loss budget.