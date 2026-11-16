---
name: Matches King rate-limit recovery
description: Safe recovery behavior for Deriv rate limits during multi-digit purchases and contract tracking.
---

Keep Matches King active after explicit Deriv rate-limit rejections by applying capped exponential backoff. A request rejected by Deriv can be retried after cooldown, but contracts already accepted must never be resent. Keep retrying rate-limited open-contract tracking so accepted positions can settle.

**Why:** The user wants Matches King to keep buying until they stop it, and screenshots showed Deriv rate limits interrupting multi-leg batches and settlement tracking. Blind retries could duplicate paid contracts or flood the broker.

**How to apply:** Back off for new entries and retry tracking with a capped delay; wait for accepted contracts to settle before starting another batch. Preserve the user's Stop control and configured Take Profit/Stop Loss limits. Never bypass Deriv's rate limits.

For high-frequency multi-digit runs, retrying a separate tracking subscription for each contract is not enough: prefer one account-wide result stream, filtered to contracts owned by the run. Keep that stream alive when individual legs settle. Reconcile missed results with paced, non-subscribing contract snapshots rather than recreating every leg's stream.

**Why:** The user returned with screenshots showing repeated tracking-rate-limit errors and an unresolved “Stopping…” state after the retry-only fix. A contract may have settled before a recovered account stream starts, so a fresh stream alone cannot guarantee its result is recovered.

**How to apply:** Reduce subscription creation, retain accepted-contract identity through cooldown and Stop, and require authoritative settlement before releasing the run lock. Do not invent a result or label the run finished merely to remove “Stopping…”.
