#!/usr/bin/env bash
set -euo pipefail

# Copies MOVs from ~/Downloads/Arihan*Goon* into fixtures/sample-media (gitignored).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/fixtures/sample-media"
mkdir -p "$DEST"

SRC="$(find "$HOME/Downloads" -maxdepth 1 -type d -name 'Arihan*Goon*' 2>/dev/null | head -1)"
if [[ -z "$SRC" ]]; then
  echo "Could not find Downloads folder matching Arihan*Goon*" >&2
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
