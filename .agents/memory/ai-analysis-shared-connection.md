---
name: AI Analysis shared connection
description: The connection model expected for the site's AI Analysis Tool.
---

The AI Analysis Tool should use the Deriv connection already established by the site, not create a separate connection flow.

**Why:** The user explicitly requested that analysis be directly connected to the site because the separate connection was not working.

**How to apply:** Reuse the site's active Deriv session for history and live ticks, and show clear connection state when it is unavailable.
