---
name: Builder FAST regression harness
description: Reliable test boundary for generated Builder settlement and stake progression.
---

Builder FAST regression tests should derive strategy metadata from the shipped Binary Matrix XML, then drive the generated before/during scope flow through the real TradeEngine and mocked broker messages. The interpreter's run promise is not a stable Jest completion boundary for delayed FAST continuations.

**Why:** The interpreter can report completion before a delayed mocked settlement re-enters the generated continuation, which makes a test either finish early or hang without proving broker-facing stake amounts.

**How to apply:** Keep the test at the TradeEngine/API subscription boundary, schedule settlement and FAST rearm events as the broker would, and assert the actual buy payload amounts plus ordinary-DBot isolation.