#!/bin/bash
# Push changes to GitHub and trigger a Vercel deployment.
# Requires GITHUB_PERSONAL_ACCESS_TOKEN, VERCEL_TOKEN, VERCEL_PROJECT_ID in Replit secrets.

set -e

if [ -z "$GITHUB_PERSONAL_ACCESS_TOKEN" ]; then
  echo "ERROR: GITHUB_PERSONAL_ACCESS_TOKEN secret is not set."
  exit 1
fi

REPO_URL="https://developercharloh:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/developercharloh/Deriv-site-new-api-charloh.git"

git --no-optional-locks remote set-url origin "$REPO_URL"

echo "Staging all changes..."
git add -A

COMMIT_MSG="${1:-"chore: update from Replit $(date '+%Y-%m-%d %H:%M')"}"
echo "Committing: $COMMIT_MSG"
git commit -m "$COMMIT_MSG" || echo "Nothing new to commit."

echo "Pushing to GitHub..."
git push --force origin main

echo "Push done!"

# Deploy to Vercel via CLI prebuilt output (git integration is intentionally disconnected).
# Build locally (npm works fine here), create .vercel/output, then vercel deploy --prebuilt.
if [ -n "$VERCEL_TOKEN" ] && [ -n "$VERCEL_PROJECT_ID" ]; then
  echo "Building site..."
  (cd artifacts/deriv-site && npm run build)

  echo "Preparing Vercel Build Output..."
  rm -rf artifacts/deriv-site/.vercel/output
  mkdir -p artifacts/deriv-site/.vercel/output/static
  cp -r artifacts/deriv-site/dist/. artifacts/deriv-site/.vercel/output/static/
  echo '{"version":3}' > artifacts/deriv-site/.vercel/output/config.json
  mkdir -p artifacts/deriv-site/.vercel
  echo "{\"orgId\":\"team_BQWnsBcAsW4szAjxsE8X2my1\",\"projectId\":\"${VERCEL_PROJECT_ID}\"}" \
    > artifacts/deriv-site/.vercel/project.json

  echo "Deploying to Vercel..."
  (cd artifacts/deriv-site && \
    VERCEL_ORG_ID=team_BQWnsBcAsW4szAjxsE8X2my1 \
    VERCEL_PROJECT_ID=${VERCEL_PROJECT_ID} \
    npx vercel@latest deploy --prebuilt --prod --yes --token=${VERCEL_TOKEN})
  echo "Live at https://www.mrcharlohfx.site"
else
  echo "VERCEL_TOKEN or VERCEL_PROJECT_ID not set — skipping deploy."
fi

echo "Done!"
