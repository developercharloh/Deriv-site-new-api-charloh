---
name: Alpha Scan live execution
description: Non-obvious constraints for keeping the public Alpha Scan Run flow usable and safe with authenticated Deriv execution.
---

The Alpha Scan must read authorization from the reactive auth observable, not only from the plain API singleton field; the latter can remain stale after login and leave Run disabled.

**Why:** The first live execution wiring could silently disable Run when the recent digit trigger did not qualify or when the non-reactive authorization snapshot had not refreshed. Both conditions looked like a broken trading action.

**How to apply:** Keep the Run click explicit, let the selected purchase market determine the contract, return startup/proposal failures to an idle state, and reserve authenticated end-to-end settlement checks for a controlled Deriv demo account.