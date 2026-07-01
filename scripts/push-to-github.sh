#!/bin/bash
# Push changes to GitHub using the stored PAT.
# Requires GITHUB_PERSONAL_ACCESS_TOKEN to be set in Replit secrets.

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

echo "Done! Vercel will now pick up the changes and deploy."
