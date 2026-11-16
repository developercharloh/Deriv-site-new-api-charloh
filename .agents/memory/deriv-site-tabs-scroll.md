---
name: Deriv-site custom Tabs content panel scrolling
description: Why custom Tabs pane IDs once failed and how nested mobile scroll layouts must be constrained
---

The shared `Tabs` component (`src/components/shared_ui/tabs/tabs.tsx`) originally extracted
`child.props.children` from the tab wrapper and discarded its `id`, leaving an unstyled
`.dc-tabs__content` pane. It now re-wraps the active pane's children in a real
`<div id={child.props.id} className="dc-tabs__content-panel">` when an ID is provided.

**Why:** ID-based layout CSS silently no-oped while the wrapper ID was discarded; after
restoring the ID, a nested mobile scroll area can still be clipped if the parent tab
content region and pane are not constrained with `min-height: 0`.

For full-page mobile tabs, target the recovered pane ID, set the pane to `display: flex`,
`flex-direction: column`, `height: 100%`, and `min-height: 0`; put `overflow-y: auto` on
the child content that owns the list and keep bottom padding for fixed controls.

For a nested mobile scrollport, sizing the recovered content panel and list alone is not
enough: the intermediate `.dc-tabs` grid and the wrapper immediately above it also need
`height: 100%` and `min-height: 0`, while the parent content wrapper must hide overflow.
Those intermediate wrappers must also use a shrinking column-flex layout; fixed heights
alone can still leave the grid at its full content height.

**Why:** The grid otherwise grows to the full card content height, so the list reports equal
`clientHeight` and `scrollHeight` and touch scrolling has no scroll range even though the
panel has an ID and `overflow-y: auto`.

**How to apply:** Verify the ID exists in the rendered DOM, scope the full-height chain to
the affected tab, make the intermediate wrappers column flex containers with hidden
overflow, then assert the list's scroll range and a lower card in the mobile regression.

## Header and pane selector isolation

Scope pane layout and active-pane `:has()` selectors to `.dc-tabs__content-panel`,
not bare tab IDs. Layout regressions must include the real header IDs and pane
structure, not only the header classes.

**Why:** Both the navigation item and the active pane use tab IDs. Bare ID selectors
applied column layout and large bottom padding to navigation items, while bare
`:has(#id-...)` matched inactive tabs too. A simplified browser fixture without IDs
incorrectly passed several alignment checks.

**How to apply:** Check both active and inactive tool tabs at mobile and tablet
widths, before and after horizontal scrolling. Require the regression to reproduce
the original failure with the unscoped selectors before trusting its passing result.
