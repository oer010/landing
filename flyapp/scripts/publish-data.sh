#!/usr/bin/env bash
# Legger én datafil på grenen notam-data (én commit, tidligere filer beholdes).
set -euo pipefail
file="$1"
dir="$(mktemp -d)"
url="https://x-access-token:${TOKEN}@github.com/${REPO}.git"
cd "$dir"
git init -q -b notam-data
if git fetch -q --depth 1 "$url" notam-data 2>/dev/null; then git checkout -q FETCH_HEAD -- . ; fi
cp "$file" .
git config user.name "github-actions[bot]"
git config user.email "41898315+github-actions[bot]@users.noreply.github.com"
git add -A
git commit -qm "Data $(date -u +%Y-%m-%dT%H:%MZ)"
git push -qf "$url" HEAD:notam-data
