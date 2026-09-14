---
name: Deriv browser regression gate timing
description: Production browser regression startup can race the splash-triggered social popup.
---

The browser regression can reach the Free Bots loader before the splash completion callback renders the SocialPopup. A one-time early dismissal then misses the popup and later lifecycle waits time out behind it.

**Why:** The popup is mounted asynchronously after the splash duration, while the Free Bots route can become interactive first.

**How to apply:** When running this regression manually, account for the late popup using its normal close action or a test-only click observer; do not remove React-owned popup DOM directly because React may later attempt to remove the same nodes.