#!/usr/bin/env bash
set -euo pipefail

# Copy local sample videos into fixtures/sample-media (gitignored).
# Usage: SAMPLE_MEDIA_SRC=/path/to/videos ./scripts/sync-sample-media.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/fixtures/sample-media"
mkdir -p "$DEST"

SRC="${SAMPLE_MEDIA_SRC:-}"
if [[ -z "$SRC" ]]; then
  echo "Set SAMPLE_MEDIA_SRC to a folder containing .mov/.mp4 files." >&2
  echo "Example: SAMPLE_MEDIA_SRC=~/Downloads/my-clips ./scripts/sync-sample-media.sh" >&2
  exit 1
fi

if [[ ! -d "$SRC" ]]; then
  echo "Directory not found: $SRC" >&2
  exit 1
fi

shopt -s nullglob
FILES=("$SRC"/*.MOV "$SRC"/*.mov "$SRC"/*.mp4 "$SRC"/*.MP4)
if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No .MOV/.mp4 files in: $SRC" >&2
  exit 1
fi

cp "${FILES[@]}" "$DEST/"
echo "Synced ${#FILES[@]} file(s) from:"
echo "  $SRC"
echo "→ $DEST"
