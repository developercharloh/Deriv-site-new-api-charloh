---
name: Nexus fresh-tick identity
description: Fresh entry confirmation must count actual broker tick events, including repeated quote values.
---

Count each new broker tick event toward Nexus's fresh-entry confirmations even when its quote matches the previous quote. The historical seed is not a fresh tick.

**Why:** Consecutive ticks can carry the same displayed quote; deduplicating by price undercounts confirmations and can prevent valid execution. This does not justify relaxing the three-tick or rolling-evidence gates.

**How to apply:** Distinguish history responses from tick events at the execution boundary, then keep contract-match checks, the three-confirmation threshold, payout validation, authorization, and session-risk safeguards unchanged.