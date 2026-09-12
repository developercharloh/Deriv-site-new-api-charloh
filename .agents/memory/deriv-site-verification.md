---
name: Deriv-site verification
description: Which checks reliably validate the Deriv site in this imported workspace
---

Use the Deriv site's managed Rsbuild workflow or `pnpm --filter @workspace/deriv-site run build` as the primary verification path. The production build has succeeded even when the package-level TypeScript check reports many unrelated missing-module and existing type errors across shared UI files.

**Why:** The imported workspace contains source from multiple app surfaces, while dependency linking and typecheck coverage are not currently aligned with the Deriv artifact's actual Rsbuild entrypoint.

**How to apply:** After frontend edits, restart `artifacts/deriv-site: web`, inspect its logs, and run the artifact build. Treat `pnpm --filter @workspace/deriv-site run typecheck` as a separate cleanup signal until its dependency/type gaps are resolved.

The Alpha Scan browser regression must target the hash route (`#alpha_scan_ai`); the site root can remain on the startup overlay and time out before the tool mounts.

**Why:** The local artifact serves the app shell at `/`, while the Alpha Scan workspace is selected by the hash router.

**How to apply:** Set `ALPHA_SCAN_URL` to a URL ending in `/#alpha_scan_ai` when running `scripts/alpha-scan-regression.mjs` against the local workflow.

For responsive UI work, a passing build and matching live HTML fingerprint only prove that the deployed bundle is current; they do not prove visual parity. Compare a settled screenshot at the target mobile viewport before calling the layout complete. The external screenshot service may return HTTP 402, in which case an attached live capture or another local settled capture is the visual source of truth.

**Why:** The Alpha Scan build was current while its live mobile layout still differed materially from the supplied reference because the small-screen rules stacked and shrank controls.

**How to apply:** Treat layout screenshots as a separate acceptance check from build, regression, and HTTP verification. Do not infer visual correctness from asset hashes.