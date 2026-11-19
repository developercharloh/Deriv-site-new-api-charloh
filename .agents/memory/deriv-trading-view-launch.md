---
name: Deriv TradingView launch
description: Reliable way to integrate Deriv's hosted advanced chart into the Deriv site.
---

Deriv's hosted chart renders its toolbar but leaves the plot blank when its page is nested in an iframe inside the Deriv site. Open the official chart as a top-level page instead. The domain root defaults to a 24-hour view; `/deriv?hide-signup=true&instrument=R_25&timePeriod=1` opens the chart on Volatility 25 at a one-minute interval.

**Why:** Direct browser testing showed the chart rendered at the requested interval as a top-level page, while the same URL inside an iframe showed a blank plot.

**How to apply:** Use an explicit user-clicked external link to the `/deriv` route, not another iframe wrapper. Verify the page at top level and check that the interval is actually applied; HTTP 200 alone does not prove the chart rendered.
