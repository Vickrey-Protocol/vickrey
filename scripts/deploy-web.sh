#!/usr/bin/env bash
#
# Deploys the site to production and proves the deploy landed.
#
#   scripts/deploy-web.sh
#
# Use this rather than `vercel --prod` directly. It stamps the commit into the build so
# the live site can say what it is, and it verifies afterwards instead of assuming.
#
# The reason it exists: the Vercel project has no git repository connected, so pushing
# to `main` triggers nothing. Four commits — an entire route restructure — sat on main
# while the live URL served the previous build and nothing said so. Connecting the repo
# is the real fix (see docs/deployments.md); this makes the manual path safe until then,
# and remains a useful post-deploy assertion afterwards.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMMIT="$(git rev-parse HEAD)"
SITE="${SITE:-https://vickrey.0xo.in}"

# Deploying a dirty tree produces a live site that matches no commit anywhere, which is
# worse than being stale — at least stale is findable.
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is dirty. Commit or stash first — a deploy must correspond to a commit." >&2
  git status --short >&2
  exit 1
fi

if ! git merge-base --is-ancestor "$COMMIT" "origin/$(git branch --show-current)" 2>/dev/null; then
  echo "HEAD is not pushed. Push first, so the live site corresponds to something others can read." >&2
  exit 1
fi

echo "Deploying $COMMIT"
npx vercel --prod --yes \
  --build-env "NEXT_PUBLIC_COMMIT=$COMMIT" \
  --build-env "NEXT_PUBLIC_BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo
echo "Waiting for the alias to move…"
for i in $(seq 1 20); do
  live="$(curl -s --max-time 20 "$SITE/api/version" | node -e \
    "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).commit??'')}catch{process.stdout.write('')}})" 2>/dev/null || true)"
  [ "$live" = "$COMMIT" ] && break
  sleep 6
done

# GRACE_MIN=0, deliberately. The grace window exists so the *scheduled* check does not
# cry wolf during the minutes between a push and a deploy. Here there is no such window:
# the deploy has just run and the alias wait above has already finished, so any drift at
# all is this deploy having failed. With the default 30-minute grace a failed deploy
# reported "ahead of live by 1 min — not stale yet" and exited 0, which turned the one
# assertion that proves a deploy landed into a message that it had not yet.
GRACE_MIN=0 node scripts/check-deployed.mjs "$SITE"
