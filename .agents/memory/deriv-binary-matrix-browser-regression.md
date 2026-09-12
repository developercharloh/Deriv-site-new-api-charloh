---
name: Binary Matrix browser regression
description: Browser-level verification constraints for the Binary Matrix loader flows
---

The Binary Matrix browser regression runs dependency-free against Node 20 with a small CDP WebSocket client and a deterministic demo-account API stub. The app’s unauthenticated landing page otherwise prevents Free Bots from rendering, and mobile Blockly view metrics can include the document offset; assert root ordering and no positive workspace scroll rather than requiring the raw metric to equal zero.

**Why:** Chromium is available but the project has no browser-test dependency, and a real account credential is not appropriate for a repeatable repository check. Scrolling the Free Bots card into view also makes Blockly’s `viewTop` negative even after the vertical scrollbar is reset.

**How to apply:** Keep the test focused on real rendered Free Bots and standard XML-loader UI, stub only the external WebSocket API before navigation, scroll the clicked controls into view, and verify all required root types plus the first root’s topmost ordering on mobile.