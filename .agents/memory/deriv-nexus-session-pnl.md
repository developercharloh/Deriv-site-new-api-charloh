---
name: Nexus session P/L
description: Product rules for total profit/loss on the visible Nexus session screen.
---

Nexus session P/L starts when the Nexus screen opens. Keep settled profit cumulative while another contract is open, show unavailable live open P/L as Pending rather than zero, and de-duplicate settlements by contract identity. Do not derive the total from the capped recent journal.

**Why:** The journal retains only recent rows, and an open contract may not yet have a valid current profit value. Using visible journal rows loses older session results; showing zero for missing open P/L misrepresents exposure.

**How to apply:** Keep realized and open results as separate parts of the Nexus session total. Regression-check the visible mobile Nexus screen through open, live update, settlement, and repeated final update states.