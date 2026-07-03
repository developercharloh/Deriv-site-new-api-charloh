---
name: Deriv-site AI orb testing quirks
description: Gotchas when writing e2e (Playwright) tests against the floating AI Signal Orb in artifacts/deriv-site.
---

The floating "AI" orb button has a perpetual CSS bounce animation while closed, which keeps its bounding box moving every frame. Playwright's default `click()` waits for the element to be visually "stable" and times out against it. A plain click or a `force: true` click both tend to fail.

**Why:** the orb toggle is implemented with `onPointerDown`/`onPointerMove`/`onPointerUp` handlers (drag-vs-click detection), not a plain `onClick`, and the CSS animation runs until the panel is open (`.ai-orb--open` sets `animation: none`).

**How to apply:** when writing a test plan for this component, instruct the testing subagent to dispatch a synthetic `pointerdown`+`pointerup` (+`click`) event pair via `page.evaluate()` directly on the orb button element, using its current bounding-rect center as coordinates. This bypasses Playwright's stability wait and reliably opens the panel.

Separately, any bot "Save & Run" flow that reaches `store.run_panel.onRunButtonClick()` will hit a global, pre-existing "You are not logged in" dialog (from `run-panel-store.ts`'s `showLoginDialog`) if the test session has no real Deriv OAuth session. This is expected and unrelated to whatever feature is under test — treat it as the natural stopping point for e2e coverage of any "run a bot" flow in this app, since there's no way to fully authenticate a real Deriv account in tests.
