---
name: Nexus digit confirmation fixtures
description: Keep deterministic Nexus digit-session browser tests aligned with the live freshness gate.
---

When a deterministic Nexus execution fixture tests a digit contract, make its fresh quotes satisfy the selected Even, Odd, Over, or Under condition. A generic rising quote sequence can pass confirmation for one route and fail for another, causing a recovery attempt to be safely cancelled and the regression to look like recovery selection failed.

**Why:** On 2026-10-01, the local browser regression selected a different-market recovery but its generic fresh ticks did not satisfy the recovery digit condition. The session correctly returned to base stake, so the journal showed only primary legs despite recovery selection working.

**How to apply:** Match fixture seed and confirmation ticks to the active digit contract while keeping the actual fresh-confirmation path enabled. Keep this coverage on deterministic local fixtures; never use broker live purchases for regression verification.