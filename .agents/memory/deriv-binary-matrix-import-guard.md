---
name: Binary Matrix XML import guard
description: Blockly root-block lifecycle behavior during the Binary Matrix strategy import
---

The Binary Matrix builder import must keep a global XML-import guard active through workspace cleanup and delayed field-option validation. The Blockly event group is not reliably attached to every internal event, so checking only `event.group` allows the Trade Parameters root to dispose itself while its nested stack is still being attached. Mobile reveal must reset the vertical position with the supported `ScrollbarPair.setY(0)` API after layout.

**Why:** The visible symptom was a builder containing only Restart Trading Conditions even though the importer initially created all three roots; the first roots were removed asynchronously after import.

**How to apply:** Set the import guard before clearing/loading XML, keep it active through cleanup and a short post-load settling window, have root-block and market-option handlers honor both the guard and the `dbot-load` event group, and call `setY(0)` after cleanup so a previous bottom scroll cannot hide the first roots.