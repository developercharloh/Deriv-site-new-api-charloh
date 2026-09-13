---
name: Deriv-site Jest ESM dependency handling
description: Why the Deriv site's Jest configuration must account for pnpm's physical package paths
---

Jest must transform `@deriv-com/ui` when it resolves through both the pnpm store path (`.pnpm/@deriv-com+ui@...`) and the nested package path (`@deriv-com/ui`). Otherwise the package's ESM entry is skipped by `transformIgnorePatterns` and Jest fails before tests run.

**Why:** The package exposes only an ESM `main.js`, while Jest executes CommonJS. pnpm's real path does not begin with `@deriv-com/ui`, so a package-only exception is insufficient.

**How to apply:** If the UI dependency or package manager changes, keep the transform exception aligned with the installed path shape and verify with the normal `pnpm --filter @workspace/deriv-site test` command.