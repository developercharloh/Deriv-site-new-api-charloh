---
name: Matches King rate-limit recovery
description: Safe recovery behavior for Deriv rate limits during multi-digit purchases and contract tracking.
---

Keep Matches King active after explicit Deriv rate-limit rejections by applying capped exponential backoff. A request rejected by Deriv can be retried after cooldown, but contracts already accepted must never be resent. Keep retrying rate-limited open-contract tracking so accepted positions can settle.

**Why:** The user wants Matches King to keep buying until they stop it, and screenshots showed Deriv rate limits interrupting multi-leg batches and settlement tracking. Blind retries could duplicate paid contracts or flood the broker.

**How to apply:** Back off for new entries and retry tracking with a capped delay; wait for accepted contracts to settle before starting another batch. Preserve the user's Stop control and configured Take Profit/Stop Loss limits. Never bypass Deriv's rate limits.
