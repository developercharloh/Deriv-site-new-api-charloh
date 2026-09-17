---
name: Proposal refresh race
description: Stale broker proposal responses can arrive after settlement refreshes the stake and proposal set.
---

Live proposal subscriptions can deliver an older response after a settlement has regenerated the purchase reference. Reject stale responses, including delayed validation errors, before they are stored or considered ready. Purchase references and retry-delay counters must also belong to the engine instance, never the module.

**Why:** The old response carries a valid proposal ID and amount, so clearing the set alone does not prevent it from reappearing during the next FAST purchase window.

**How to apply:** Gate every asynchronous proposal response by the current purchase reference; regenerate proposals when the underlying symbol changes; wait for the current reference before buying; regression tests should delay the prior response, refresh the stake, then verify the fresh proposal is the only one purchased.