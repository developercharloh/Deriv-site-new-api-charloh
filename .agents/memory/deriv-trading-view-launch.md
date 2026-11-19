---
name: Deriv TradingView embed
description: Correct route and layout for embedding Deriv's hosted advanced chart.
---

Use Deriv's `/deriv` chart route, not the `charts.deriv.com` domain root. The root defaults to a 24-hour view and ignores the chart query parameters. The route `/deriv?hide-signup=true&instrument=R_25&timePeriod=1` opens Volatility 25 at a one-minute interval.

**Why:** Browser testing showed the domain root inside an iframe can render its toolbar with a blank plot, while the exact `/deriv` route rendered candles inside an iframe on both desktop and mobile.

**How to apply:** Embed the exact `/deriv` route and keep a full-height, shrinking flex chain through the active tab wrappers, page container, and iframe. Verify the rendered chart on desktop and mobile; HTTP 200 alone does not prove the chart rendered.
