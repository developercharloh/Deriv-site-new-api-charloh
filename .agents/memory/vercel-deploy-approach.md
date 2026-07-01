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
