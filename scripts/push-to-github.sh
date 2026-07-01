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

# Trigger Vercel deployment via API
if [ -n "$VERCEL_TOKEN" ] && [ -n "$VERCEL_PROJECT_ID" ]; then
  echo "Triggering Vercel deployment..."
  RESPONSE=$(curl -s -X POST "https://api.vercel.com/v13/deployments" \
    -H "Authorization: Bearer ${VERCEL_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"deriv-site-new-api-charloh\",
      \"gitSource\": {
        \"type\": \"github\",
        \"repoId\": \"$(curl -s -H "Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" https://api.github.com/repos/developercharloh/Deriv-site-new-api-charloh | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")\",
        \"ref\": \"main\"
      },
      \"projectId\": \"${VERCEL_PROJECT_ID}\"
    }")
  echo "$RESPONSE" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);if(j.url)console.log('Deploying to: https://'+j.url);else console.log('Vercel response:',JSON.stringify(j))})" 2>/dev/null || echo "Vercel triggered (check dashboard for status)"
else
  echo "VERCEL_TOKEN or VERCEL_PROJECT_ID not set — skipping Vercel trigger."
fi

echo "Done!"
