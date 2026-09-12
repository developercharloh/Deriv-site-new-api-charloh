---
name: Bot condition analysis status
description: Shared live reporting of last-digit conditions for robot runs
---

Last-digit robot conditions should publish the latest evaluated condition, digits, market, and boolean result through the shared bot event path. The UI can then show a green check for a match and a red X for an unmet condition in the run reporting views. Any XML robot that resets its entry signal after a run threshold must place the same scan loop in the repeated before-purchase path; the initial submarket loop is not re-entered by `trade_again`.

**Why:** Binary Matrix and other XML robots evaluate conditions asynchronously inside the shared tick engine, so a UI-only calculation can display stale or different digits from the condition that actually controlled the robot.

**How to apply:** Emit one status event after each `last_digits_condition` evaluation. Preserve the final false evaluation in an elseif chain, because it explains why no purchase occurred; do not write these messages only to Journal text or only to the native Binary Matrix runner. When a threshold resets the signal, re-evaluate all conditions before the next purchase rather than reusing the prior direction.