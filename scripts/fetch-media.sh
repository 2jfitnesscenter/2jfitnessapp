#!/usr/bin/env bash
# Fetch only the image/GIF families historically referenced by Exercise Library.
# The project owner's decision to enable serving does not change the provenance records or
# assert ownership/licensing; see docs/legal/exercise-media-inventory.csv.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p media/img media/gif
if find media/img -maxdepth 1 -type f -name '*.jpg' -print -quit | grep -q . \
  && find media/gif -maxdepth 1 -type f -name '*.gif' -print -quit | grep -q .; then
  echo "Exercise media already present — skipping download."
  exit 0
fi
command -v git >/dev/null || { echo "git is required to fetch exercise media." >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q
git -C "$tmp" remote add origin https://github.com/hasaneyldrm/exercises-dataset
git -C "$tmp" fetch --depth 1 origin 7455efae41b330c265e7cd4b78dfa848e7ce5ebd
git -C "$tmp" checkout --detach -q FETCH_HEAD
for file in "$tmp"/images/*.jpg; do
  [ -e "$file" ] || continue
  [ -e "media/img/${file##*/}" ] || cp "$file" media/img/
done
for file in "$tmp"/videos/*.gif; do
  [ -e "$file" ] || continue
  [ -e "media/gif/${file##*/}" ] || cp "$file" media/gif/
done
printf 'Exercise media ready: %s images, %s GIFs.\n' \
  "$(find media/img -maxdepth 1 -type f -name '*.jpg' | wc -l)" \
  "$(find media/gif -maxdepth 1 -type f -name '*.gif' | wc -l)"
