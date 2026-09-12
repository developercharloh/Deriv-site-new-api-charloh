---
name: Deriv builder and settlement validation
description: Durable checks for the Blockly default workspace and Deriv transaction updates.
---

The default Blockly XML is executable input, not static documentation: validate it as XML and verify every block type is registered before shipping. Deriv settlement messages can omit formatted spot fields, so transaction updates must preserve known entry/exit values and accept raw tick fields.

**Why:** malformed default XML blocked the entire mobile builder, while partial settlement payloads produced transaction rows with stake and P/L but blank spot details.

**How to apply:** include XML parsing plus block-registration checks in builder changes, and treat transaction records as merged state rather than replacing earlier open-position data with undefined settlement fields.