#!/bin/bash
# deploy.sh — Push current source to GitHub (history-preserving), which triggers Vercel auto-deploy.
# Usage:  bash traderharloh/deploy.sh
#         bash traderharloh/deploy.sh "My commit message"
# Requires: GITHUB_TOKEN env var set in Replit Secrets.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MSG="${1:-Deploy: $(date '+%Y-%m-%d %H:%M:%S')}"
ISO_PKG="/tmp/isogit-deploy-pkg"
WORK="/tmp/isogit-work-$$"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN is not set. Add it in Replit Secrets." >&2
  exit 1
fi

echo "Deploy: $MSG"

# Install isomorphic-git if not already present
if [ ! -f "$ISO_PKG/node_modules/isomorphic-git/package.json" ]; then
  echo "Installing isomorphic-git (one-time)..."
  mkdir -p "$ISO_PKG"
  npm install --prefix "$ISO_PKG" isomorphic-git --loglevel=error 2>&1 | grep -v "^npm warn" || true
fi

cd "$SCRIPT_DIR"

node - "$MSG" "$ISO_PKG" "$SCRIPT_DIR" "$WORK" << 'JSEOF'
const [,, MSG, ISO_PKG, SRC, WORK] = process.argv;
const git  = require(ISO_PKG + '/node_modules/isomorphic-git');
const http = require(ISO_PKG + '/node_modules/isomorphic-git/http/node');
const fs   = require('fs');
const path = require('path');

const REPO_URL = 'https://github.com/developercharloh/Deriv-site-new-api-charloh.git';
const TOKEN    = process.env.GITHUB_TOKEN;
const onAuth   = () => ({ username: 'developercharloh', password: TOKEN });

// Files/dirs that should never be pushed (mirrors .gitignore)
const HARD_SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.pnpm', 'coverage', '.cache', 'pnpm-lock.yaml']);

function walkRel(dir, base) {
  let files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (HARD_SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    const rel  = path.relative(base, full);
    if (e.isDirectory()) files = files.concat(walkRel(full, base));
    else files.push(rel);
  }
  return files;
}

function copyDir(srcDir, dstDir) {
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (HARD_SKIP.has(e.name)) continue;
    const s = path.join(srcDir, e.name);
    const d = path.join(dstDir, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

async function run() {
  // 1. Clone remote (shallow) to start from real history
  console.log('Cloning current repo...');
  if (fs.existsSync(WORK)) fs.rmSync(WORK, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });

  await git.clone({
    fs, http, dir: WORK,
    url: REPO_URL,
    depth: 1,
    singleBranch: true,
    ref: 'main',
    onAuth,
  });

  // 2. Build set of source files to push
  const srcFiles = new Set(walkRel(SRC, SRC));

  // 3. Prune: remove files in the clone that no longer exist in source
  const cloneFiles = walkRel(WORK, WORK);
  for (const rel of cloneFiles) {
    if (!srcFiles.has(rel)) {
      fs.unlinkSync(path.join(WORK, rel));
    }
  }

  // 4. Copy all source files into clone (add + overwrite)
  console.log('Syncing', srcFiles.size, 'source files...');
  copyDir(SRC, WORK);

  // 5. Stage all changes using statusMatrix (respects .gitignore, captures adds/deletes/modifies)
  const matrix = await git.statusMatrix({ fs, dir: WORK });
  let changed = 0;
  for (const [filepath, head, workdir, stage] of matrix) {
    if (head === 1 && workdir === 1 && stage === 1) continue; // unchanged
    if (workdir === 0) {
      await git.remove({ fs, dir: WORK, filepath });
    } else {
      await git.add({ fs, dir: WORK, filepath });
    }
    changed++;
  }

  if (changed === 0) {
    console.log('Nothing to deploy — no changes detected.');
    fs.rmSync(WORK, { recursive: true });
    process.exit(0);
  }
  console.log(changed + ' file(s) changed.');

  // 6. Commit on top of real history
  await git.commit({
    fs, dir: WORK,
    message: MSG,
    author: { name: 'developercharloh', email: 'mrcharlohfx@gmail.com' },
  });

  // 7. Push without force — history preserved
  console.log('Pushing to GitHub...');
  await git.push({
    fs, http, dir: WORK,
    url: REPO_URL,
    remote: 'origin',
    remoteRef: 'main',
    onAuth,
  });

  fs.rmSync(WORK, { recursive: true });
  console.log('Done. Vercel is deploying your changes automatically.');
  console.log('Track at: https://vercel.com/developercharloh/traderharloh');
}

run().catch(e => {
  if (fs.existsSync(WORK)) { try { fs.rmSync(WORK, { recursive: true }); } catch(_) {} }
  console.error('Deploy failed:', e.message);
  process.exit(1);
});
JSEOF
