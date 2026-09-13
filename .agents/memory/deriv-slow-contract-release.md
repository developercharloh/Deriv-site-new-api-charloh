---
name: SLOW contract lease release
description: The null-key edge case that can stall generated SLOW runs after settlement
---

Generated SLOW purchases may acquire the shared contract lease using the live broker tick while the later settlement callback has no Redux signal key. A null settlement key must release by owner and contract ID rather than fail key matching.

**Why:** If that lease remains active, the bot stays running but every later SLOW purchase is rejected as if another contract were still open.

**How to apply:** Keep FAST slot keys explicit and strict. Treat null as an absent SLOW signal key only during release; continue requiring owner and contract identity.