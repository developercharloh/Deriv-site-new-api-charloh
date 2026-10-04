---
name: Bot condition analysis status
description: Shared live reporting of last-digit conditions for robot runs
---

Last-digit robot conditions should publish the latest evaluated condition, digits, market, and boolean result through the shared bot event path. The UI can then show a green check for a match and a red X for an unmet condition in the run reporting views. Any XML robot that resets its entry signal after a run threshold must place the same scan loop in the repeated before-purchase path; the initial submarket loop is not re-entered by `trade_again`.

Smart Over 2's Journal status is a required operating indicator: keep the evaluated digit window and MET/NOT MET result visible even while Virtual Hook blocks live purchases. For V3, show the latest four digits, the fixed 3–6 result, and virtual-loss progress in one up-to-date status row.

**Why:** Binary Matrix and other XML robots evaluate conditions asynchronously inside the shared tick engine, so a UI-only calculation can display stale or different digits from the condition that actually controlled the robot. The user said Journal visibility is crucial to know whether Smart Over 2 is running and what is blocking a purchase.

**How to apply:** Emit one status event after each `last_digits_condition` evaluation. Preserve the final false evaluation in an elseif chain, because it explains why no purchase occurred; do not write these messages only to Journal text or only to the native Binary Matrix runner. Keep V3's latest-digit status as a single updated row and virtual/live entries and settlements as separate Journal messages. When a threshold resets the signal, re-evaluate all conditions before the next purchase rather than reusing the prior direction.

Native Binary Matrix AI must lock the selected matrix condition after its initial analysis and keep that condition through losses. A false window logs and publishes the same condition but does not buy; only a true window can buy. Clear the lock only after the configured number of wins, then collect a fresh digit window. Publish the market, condition, configured count, digits, and TRUE/FALSE result to both the shared analysis event and the Journal on each complete live tick window.

**Why:** Re-evaluating the rolling matrix after every loss changes the bot's logic and makes a loss look like an unintended reanalysis. The operator needs the per-tick FALSE results to distinguish waiting from a broken runner.

**How to apply:** Keep decision selection separate from settlement stake progression. Losses update only Martingale; wins increment the reanalysis counter. The Journal message should use the same payload as the visible Last Digits Analysis status.

Generated DBot Builder runs also need a settlement-authoritative re-analysis barrier. When the configured win count is reached, block every condition check on the settlement tick and clear the barrier only after a newer subscribed tick arrives.

**Why:** The repeated Blockly scan can otherwise reuse the final winning tick and appear not to re-analyse, especially in FAST mode where the outer loop is clock-driven.

**How to apply:** Set the barrier from authoritative settlement handling, preserve it across generated cycle restarts, and let the existing repeated before-purchase scan evaluate the full condition chain only on the fresh tick.

Generated Blockly purchases must also publish their resolved contract mapping. The uploaded Digit Pro strategy maps `DIGITOVER` to Over 2 and `DIGITUNDER` to Under 7; reporting only the generic condition or an older native-matrix label makes Journal and transactions appear to disagree with the bot.

**Why:** Strategy conditions and purchase mappings are separate Blockly blocks, so a correct condition result alone does not tell the operator which contract type and barrier were actually sent.

**How to apply:** Emit the mapping from the shared purchase path, attach it to the live analysis banner and Journal, and include digit-contract barriers in transaction names.