#!/usr/bin/env bash
# Fetch the 180 px still picture of every exercise imported from openGym (DuarteSantos8/openGym, AGPL-3.0)
# into media/img/opengym/<id>.webp, so the web server serves them from our own disk. Pinned commit, no branch.
# The animations (clips) are a later step. Provenance and the held-back list: docs/OPENGYM_CATALOGUE_IMPORT.md.
set -euo pipefail
cd "$(dirname "$0")/.."
OPENGYM_COMMIT=8fb98b16861a2728652302a7e6e30c50548493a0
dest=media/img/opengym
mkdir -p "$dest"
if find "$dest" -maxdepth 1 -type f -name '*.webp' -print -quit | grep -q .; then
  echo "openGym stills already present — skipping download."
  exit 0
fi
command -v git >/dev/null || { echo "git is required to fetch openGym media." >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# blobless + sparse: only the still pictures are downloaded, not the rest of the repository
git clone -q --filter=blob:none --no-checkout --sparse https://github.com/DuarteSantos8/openGym "$tmp/src"
git -C "$tmp/src" sparse-checkout set catalogue/media/still
git -C "$tmp/src" checkout -q "$OPENGYM_COMMIT"
copied=0
for file in "$tmp"/src/catalogue/media/still/*.webp; do
  [ -e "$file" ] || continue
  cp "$file" "$dest/"
  copied=$((copied + 1))
done
printf 'openGym stills ready: %s files in %s (commit %s).\n' "$copied" "$dest" "$OPENGYM_COMMIT"
