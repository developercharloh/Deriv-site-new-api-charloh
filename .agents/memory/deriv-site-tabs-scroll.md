---
name: Deriv-site custom Tabs content id is stripped
description: Why id-based mobile scroll/height CSS on custom Tabs panes silently no-ops in this repo
---

The shared `Tabs` component (`src/components/shared_ui/tabs/tabs.tsx`) renders each pane
by extracting `child.props.children` from the tab's wrapper `<div id="..." label="...">`.
The wrapper div itself (and its `id`) is discarded — only its children land in the DOM,
inside an unstyled `.dc-tabs__content` div.

**Why:** Any CSS written to target a tab pane by the `id` you passed on that wrapper div
(e.g. `#id-ai-analysis { overflow-y: auto }`) will never match anything, because that id
never reaches the DOM. This caused a real bug: a mobile scroll-fix for 4 full-page custom
tabs (Free Bots, AI Analysis, D-Circles, Advanced D-Trader) was dead CSS.

**How to apply:** Fixed by having `Tabs` re-wrap the active pane's children in a real
`<div id={child.props.id} className="dc-tabs__content-panel">` when `child.props.id` is
set. If you add new full-page tabs relying on an `id`/`className` selector from the
wrapper div passed into `Tabs`, verify the id actually appears in the rendered DOM first —
don't assume it does just because it's a prop on the JSX you wrote in the parent.
