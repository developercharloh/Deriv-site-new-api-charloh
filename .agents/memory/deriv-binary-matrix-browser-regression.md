---
name: Binary Matrix browser regression
description: Browser-level verification constraints for the Binary Matrix loader flows
---

The Binary Matrix browser regression runs dependency-free against Node 20 with a small CDP WebSocket client and a deterministic demo-account API stub. The app’s unauthenticated landing page otherwise prevents Free Bots from rendering, and mobile Blockly view metrics can include the document offset; assert root ordering and no positive workspace scroll rather than requiring the raw metric to equal zero. The test must also assert that the route reaches `#bot_builder` and that nested compatibility blocks are present, because the app preloads a default workspace even while Free Bots is still visible. A clean profile does not exercise persisted localForage workspaces, so blank saved XML needs a separate fallback check.

**Why:** Chromium is available but the project has no browser-test dependency, and a real account credential is not appropriate for a repeatable repository check. Scrolling the Free Bots card into view also makes Blockly’s `viewTop` negative even after the vertical scrollbar is reset. Checking only root blocks can produce a false pass against the default `main.xml`.

**How to apply:** Keep the test focused on real rendered Free Bots and standard XML-loader UI, stub only the external WebSocket API before navigation, scroll the clicked controls into view, verify `#bot_builder`, all required root types, the compatibility block counts, and the first root’s topmost ordering on mobile. Also cover an existing empty saved workspace so startup cannot silently render a blank canvas. Custom Blockly message placeholders must match the number of `args0` entries or nested imports can fail while leaving the roots visible.