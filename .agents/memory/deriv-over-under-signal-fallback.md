---
name: Over/Under signal fallback after bot removal
description: Preserve V1 Over/Under signal launches without restoring the removed AI bot.
---

After removing Over Under AI Signals Bot from the public catalog and templates, route V1 Over/Under signal runs through the existing Over / Under Signal Bot. It uses standard same-direction recovery rather than the removed bot's AI cross-direction recovery. Keep V2's direct signal flow unchanged.

**Why:** The removed bot was also the previous V1 signal-engine target. The user chose to preserve V1 launches through the existing alternative despite its different recovery behavior.

**How to apply:** Keep the retired bot absent from the catalog, XML assets, and patch map; use the existing Over/Under Signal template for V1.
