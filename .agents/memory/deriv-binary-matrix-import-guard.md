---
name: Binary Matrix XML import guard
description: Blockly root-block lifecycle behavior during the Binary Matrix strategy import
---

The Binary Matrix builder import must keep a global XML-import guard active through workspace cleanup and delayed field-option validation. The Blockly event group is not reliably attached to every internal event, so checking only `event.group` allows the Trade Parameters root to dispose itself while its nested stack is still being attached. Mobile reveal must reset the workspace with `workspace.scroll(0, 0)` after layout; scrollbar setters use handle ratios and can leave long imports scrolled below the visible roots.

**Why:** The visible symptom was a builder containing only Restart Trading Conditions even though the importer initially created all three roots; the first roots were removed asynchronously after import.

**How to apply:** Set the import guard before clearing/loading XML, keep it active through cleanup and a short post-load settling window, have root-block and market-option handlers honor both the guard and the `dbot-load` event group, and call `workspace.scroll(0, 0)` after cleanup so a previous bottom scroll cannot hide the first roots.

The Builder's own initial `main.xml` load must use the same guard; otherwise the default workspace can start with only Restart Trading Conditions before a Free Bots load is attempted. The shared market limitation routine also needs to return during import because child Trade Definition blocks call it directly. Real API dropdown callbacks can arrive several seconds after import, so a one-second guard/reveal is not enough: mandatory roots must not self-dispose on a transient empty child stack, and mobile startup needs repeated top reveals until the user interacts. Use viewport width as a mobile-layout fallback when the device-store flag is stale.

Concurrent import paths share this lifecycle guard. Do not let each loader clear one global boolean from its own timer: startup, saved-workspace, uploaded-workspace, and Free Bots imports can overlap. Track active imports independently and clear the flag only after the last lease releases; keep it through the delayed validation window (six seconds is the current baseline).

**Why:** The Builder startup import could finish its short timer while a Free Bot template was still attaching roots and waiting on asynchronous dropdown validation, allowing required blocks to self-dispose.

**How to apply:** Route every XML import through the shared lease guard, including error paths. Avoid direct `__DBOT_LOADING_XML` writes in individual loaders.