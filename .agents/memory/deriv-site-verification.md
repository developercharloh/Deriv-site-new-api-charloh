---
name: Deriv-site verification
description: Which checks reliably validate the Deriv site in this imported workspace
---

Use the Deriv site's managed Rsbuild workflow or `pnpm --filter @workspace/deriv-site run build` as the primary verification path. The production build has succeeded even when the package-level TypeScript check reports many unrelated missing-module and existing type errors across shared UI files.

**Why:** The imported workspace contains source from multiple app surfaces, while dependency linking and typecheck coverage are not currently aligned with the Deriv artifact's actual Rsbuild entrypoint.

**How to apply:** After frontend edits, restart `artifacts/deriv-site: web`, inspect its logs, and run the artifact build. Treat `pnpm --filter @workspace/deriv-site run typecheck` as a separate cleanup signal until its dependency/type gaps are resolved.