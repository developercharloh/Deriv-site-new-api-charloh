---
name: Free Bot section classification
description: Distinguish Blockly template classification from explicit native-runner placement.
---

For Blockly-template bots, classify registered custom blocks as **Premium Bots** and templates without custom blocks as **Smart Contract Bots**. Native runners are assigned explicitly; Edging pro Engine is a native runner in **Edging Bots**.

**Why:** The custom-block rule applies to XML-backed bots. The user explicitly placed the native Edging pro Engine in the Edging section, so template classification must not override that placement.

**How to apply:** Inspect XML-backed bots against the custom-block registry. For native runners, use their explicit section and runner metadata instead.