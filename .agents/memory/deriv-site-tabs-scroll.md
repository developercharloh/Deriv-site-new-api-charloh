---
name: Deriv-site Tabs content panel scrolling
description: How the shared Tabs component exposes active pane IDs for mobile scroll layouts
---

The shared `Tabs` component (`src/components/shared_ui/tabs/tabs.tsx`) renders the active
tab inside `.dc-tabs__content-panel` and preserves `child.props.id` on that panel.

**Why:** The active pane ID is available for layout CSS, but the parent tab content region
and the pane must still be constrained with `min-height: 0` so a nested mobile scroll area
can expand and scroll instead of being clipped by the fixed main layout.

**How to apply:** For full-page mobile tabs, target the preserved pane ID, set the pane to
`display: flex`, `flex-direction: column`, `min-height: 0`, and put `overflow-y: auto`
on the child content that owns the list. Keep bottom padding for any fixed controls.
