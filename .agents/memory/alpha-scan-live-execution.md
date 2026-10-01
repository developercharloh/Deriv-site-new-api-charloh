---
name: Alpha Scan live execution
description: Non-obvious constraints for keeping the public Alpha Scan Run flow usable and safe with authenticated Deriv execution.
---

The Alpha Scan must read authorization from the reactive auth observable, not only from the plain API singleton field; the latter can remain stale after login and leave Run disabled.

**Why:** The first live execution wiring could silently disable Run when the recent digit trigger did not qualify or when the non-reactive authorization snapshot had not refreshed. Both conditions looked like a broken trading action.

**How to apply:** Keep the Run click explicit, let the selected purchase market determine the contract, return startup/proposal failures to an idle state, and reserve authenticated end-to-end settlement checks for a controlled Deriv demo account.

The Nexus artwork controls synchronize values into the hidden Alpha controller through synthetic DOM events. Launch must be dispatched on the next macrotask so React commits those values before the controller snapshots its runtime configuration.

**Why:** Dispatching launch in the same event handler can start execution with the controller's previous stake, martingale, or risk limits even though the artwork visibly shows the new settings.

**How to apply:** When a visual wrapper drives hidden Alpha controls, update the controls first and defer the launch event; keep manual stop as a separate event that clears the session without discarding journal updates.

Manual Stop must also invalidate any launch waiting on an active scan. A completed scan may resume execution only while the original launch is still pending; Stop during the scan must prevent all later purchases.

**Why:** The scan-to-launch handoff is asynchronous, so a late completion can otherwise recreate a session after the user has stopped it.

**How to apply:** Keep the resume event synchronous with the scan-completion effect and validate the pending launch state before consuming it. Do not schedule an unguarded delayed continuation.