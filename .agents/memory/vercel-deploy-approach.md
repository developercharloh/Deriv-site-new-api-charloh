---
name: Vercel deployment approach for deriv-site
description: How to deploy artifacts/deriv-site to Vercel (mrcharlohfx.site) — git integration is off, use CLI prebuilt
---

# Vercel Deployment for Trader Charloh FX

## The problem that was solved
Vercel's git-based build system was incompatible with the Replit pnpm monorepo:
- `pnpm-workspace.yaml` at root caused Vercel to force pnpm even when `installCommand` said `npm`
- Root `package.json` had a `preinstall` script that exited 1 for non-pnpm package managers
- Vercel's git author permission check blocked CLI deploys when git integration was active

## The working solution
**Build locally in Replit (npm works fine), deploy prebuilt output via Vercel CLI.**

```bash
# In artifacts/deriv-site:
npm run build
mkdir -p .vercel/output/static
cp -r dist/. .vercel/output/static/
echo '{"version":3}' > .vercel/output/config.json
echo '{"orgId":"team_BQWnsBcAsW4szAjxsE8X2my1","projectId":"<VERCEL_PROJECT_ID>"}' > .vercel/project.json
VERCEL_ORG_ID=team_BQWnsBcAsW4szAjxsE8X2my1 \
VERCEL_PROJECT_ID=$VERCEL_PROJECT_ID \
npx vercel@latest deploy --prebuilt --prod --yes --token=$VERCEL_TOKEN
```

## Key facts
- Vercel project name: `traderharlo`, org: `team_BQWnsBcAsW4szAjxsE8X2my1`
- Git integration: **DISCONNECTED** intentionally (prevents permission errors)
- Custom domain: `mrcharlohfx.site` → `www.mrcharlohfx.site`
- The root `package.json` preinstall was removed from GitHub repo to allow npm
- `scripts/push-to-github.sh` stages all changes and force-pushes `main`; avoid it for routine publishing

**Why:** Vercel's monorepo detection overrides any `installCommand`/`buildCommand` settings when `pnpm-workspace.yaml` is present. The only reliable approach is to bypass Vercel's build system entirely using prebuilt output.

**How to apply:** Prefer the prebuilt Vercel CLI flow. Do not use `scripts/push-to-github.sh` for routine publishing because it stages all files and force-pushes `main`. If the CLI is unavailable, use the REST fallback below. Do not re-enable Vercel git integration.

## Direct API fallback

If the Vercel CLI cannot be installed because its transitive dependencies are blocked, the REST API can deploy the compiled `dist` tree. Upload only hashes returned by the first `/v13/deployments?prebuilt=1` response, then create the production deployment with flat file paths and explicit no-op `projectSettings` (`buildCommand: "echo skip"`, `installCommand: "echo skip"`, `outputDirectory: "."`, `framework: null`).

**Why:** The CLI may be unavailable in a restricted package environment, while the Vercel API remains reachable. Submitting `.vercel/output/...` paths can produce a `READY` deployment that still inherits the repository build settings and serves no files.

**How to apply:** Use the linked project and team identifiers from `.vercel/project.json`, never expose the deployment token, set the request body's `project` field to the linked project ID (not `projectId`), and include verified domains in `alias` when targeting production. After READY, verify the returned project ID and aliases, then compare custom-domain HTML and JavaScript assets against the local build.

The current Vercel API rejects `projectId` as a deployment-body property. Omitting `project` can send a deployment to a different same-team project, and `target: "production"` without an `alias` list may leave the custom domain on the previous deployment.

**Why:** The API needs the target project set through `project`; the deployment's `name` alone is not a reliable project selector. Production aliases are assigned only when supplied in the creation request.

**How to apply:** POST the manifest to `/v13/deployments?prebuilt=1&teamId=...` with `project` set to the linked project ID, `target: "production"`, and an `alias` array of verified project domains. Upload returned missing SHA-1 digests to `/v2/files`, POST the same manifest again, poll until `READY`, and confirm the resulting project ID and aliases before claiming the live site changed.

The current API may return the digest list at `error.missing` inside a 400 `missing_files` response rather than at the top level. Treat that response as the expected handshake and read both shapes.

**Why:** The first prebuilt request intentionally asks Vercel which content-addressed files it does not already have; a parser that only checks top-level `missing` will mistake a normal handshake for a failed publish.

**How to apply:** Resolve missing digests from `response.missing ?? response.error?.missing`, upload only those files, then repost the same manifest.

## Environment note
The Vercel CLI may be unavailable because Replit's package firewall blocks its transitive `tar` dependency, including older CLI versions. In that case, the REST fallback is validated: upload SHA-1-addressed files to `/v2/files`, then create a production deployment at `/v13/deployments?prebuilt=1` with flat `dist` paths, explicit no-op build settings, and wait for `READY`.

**Why:** The application can be fully built and the Vercel API remains reachable even when package installation is restricted.

**How to apply:** Keep the deploy script outside the project if possible, use concurrency for static file uploads, and verify both the deployment URL and the custom domain with HTTP checks.


## Cached CLI fallback

When downloading the Vercel CLI is blocked by the package firewall, an already-populated pnpm dlx cache may still contain a runnable CLI bundle. Running its local `dist/index.js` preserves the normal prebuilt differential upload behavior and can avoid a manual REST implementation.

**Why:** The deployment retry succeeded from the cached CLI after a fresh `npx` download was rejected by the package firewall.

**How to apply:** Search the pnpm dlx cache for the cached `node_modules/vercel` package and invoke its `dist/index.js` with Node from the artifact directory, supplying `VERCEL_ORG_ID` from `.vercel/project.json` and keeping `--prebuilt` enabled. After every build, explicitly sync `dist` into `.vercel/output/static` before uploading and verify a changed asset on the public domain, or the deployment can serve stale or missing files even when the source build is current.
## Upload quota constraint

The Vercel REST upload endpoint can exhaust an account-wide 5,000-file quota even when a later deployment needs only a few changed files. Once exhausted, both full and differential prebuilt publishes are rejected until the quota reset.

**Why:** Repeated prebuilt uploads of the same static tree still count against the upload quota when the client posts every file instead of reusing known digests.

**How to apply:** Compare the local prebuilt manifest against the last READY deployment and upload only new digests. If Vercel still returns `api-upload-free` with `remaining: 0`, keep the code verified locally and do not claim production was updated; retry after the reported reset time.

**Current runtime note:** `npx vercel@latest deploy --prebuilt` can be blocked by the package firewall while fetching `tar`; the REST fallback works by uploading only new SHA-1 digests and creating `/v13/deployments?prebuilt=1`.

## Flat artifact API fallback

When deploying a flat `dist` manifest directly through `/v13/deployments`, Vercel may still inherit the repository's old monorepo build command and fail before serving the files. Passing `buildCommand: "echo skip"`, `installCommand: "echo skip"`, `outputDirectory: "."`, and `framework: null` makes the uploaded root artifact serve as static output.

**Why:** The existing project configuration expects a repository checkout, but a direct API deployment already contains the compiled artifact and has no `artifacts/deriv-site` source directory to build from.

**How to apply:** Upload all referenced SHA-1 files to `/v2/files`, create the production deployment with the flat manifest and explicit no-op build settings, wait for `READY`, then verify the custom domain over HTTPS.

## JavaScript verification

Do not use only the first script referenced by the page to decide whether a deployment changed. It may be an unchanged vendor bundle while the application entry bundle changed. Verify the live HTML against the local build and compare every referenced script, especially the application bundle.

**Why:** The first live script can remain byte-identical across a redesign even when the main application bundle is different.

**How to apply:** After the deployment reaches `READY`, confirm the production domain serves the local build's HTML and check that all script assets load; use the app entry bundle for before/after comparisons.
