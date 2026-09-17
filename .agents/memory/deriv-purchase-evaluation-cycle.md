---
name: Purchase evaluation cycle
description: How live bot confidence and indicator checks stay coherent while broker ticks continue arriving.
---

Purchase gates that combine asynchronous history requests with live indicator reads must bind every value to one evaluation cycle, not compare each result to the moving current tick. A normal tick can arrive during analysis without invalidating the cycle.

**Why:** Requiring the exact current tick caused valid Rise/Fall entries to be silently rejected between the confidence request and the final broker purchase.

**How to apply:** Capture the evaluation tick when the before-purchase cycle begins, tag confidence and indicator results with that cycle, and reset the cycle when the locked selection is released.