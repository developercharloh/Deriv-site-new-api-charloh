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
- `scripts/push-to-github.sh` handles full flow: git push → build → vercel deploy --prebuilt

**Why:** Vercel's monorepo detection overrides any `installCommand`/`buildCommand` settings when `pnpm-workspace.yaml` is present. The only reliable approach is to bypass Vercel's build system entirely using prebuilt output.

**How to apply:** Any time code needs to be deployed to Vercel, run `bash scripts/push-to-github.sh` from the project root. Do NOT re-enable Vercel git integration.

## Direct API fallback

If the Vercel CLI cannot be installed because its transitive dependencies are blocked, the REST API can deploy the same prebuilt output. Upload each file to `/v2/files` by SHA, then create the deployment through `/v13/deployments?prebuilt=1`. The file references must retain project-root paths such as `.vercel/output/config.json` and `.vercel/output/static/...`; flattening the output directory makes Vercel run the repository build instead of serving the prebuilt output.

**Why:** The CLI may be unavailable in a restricted package environment, while the Vercel API remains reachable. Vercel’s prebuilt detector depends on both the manifest and its `.vercel/output/` path.

**How to apply:** Use the existing project and team identifiers from `.vercel/project.json`, never expose the deployment token, include the project id in the deployment body, and wait for `READY` before checking the custom domain.

## Environment note
The Vercel CLI may be unavailable because Replit's package firewall blocks its transitive `tar` dependency, including older CLI versions. In that case, the REST fallback is validated: upload SHA-1-addressed files to `/v2/files`, then create a production deployment at `/v13/deployments?prebuilt=1` with `.vercel/output/...` file paths and wait for `READY`.

**Why:** The application can be fully built and the Vercel API remains reachable even when package installation is restricted.

**How to apply:** Keep the deploy script outside the project if possible, use concurrency for static file uploads, and verify both the deployment URL and the custom domain with HTTP checks.
