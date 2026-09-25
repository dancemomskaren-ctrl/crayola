#!/usr/bin/env bash
# Codespaces bootstrap for Crayola.
#
# Runs automatically as postCreateCommand when the Codespace is created.
# Goal: a container where renders actually work — which on macOS required
# installing ffmpeg-full, because Homebrew ships a lite build with no libass.

set -euo pipefail

echo "▶ ffmpeg"
sudo apt-get update -qq
sudo apt-get install -y -qq ffmpeg

# The one check that matters. Without these filters every render fails with
# exit 8, "Error opening output files: Filter not found".
if ffmpeg -hide_banner -filters 2>/dev/null | grep -qE '(^|[[:space:]])(ass|subtitles|drawtext)([[:space:]]|$)'; then
  echo "  ✓ ffmpeg has ass / subtitles / drawtext — renders will work"
else
  echo "  ✗ ffmpeg is MISSING ass / subtitles / drawtext — renders will fail."
  echo "    Do not trust a green test run until this is resolved."
fi

echo "▶ bun"
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  # shellcheck disable=SC2016
  echo 'export PATH="$HOME/.bun/bin:$PATH"' >> "$HOME/.bashrc"
  export PATH="$HOME/.bun/bin:$PATH"
fi
bun --version

echo "▶ dependencies"
bun install

echo "▶ verification gate"
if ./scripts/verify.sh; then
  echo "  ✓ GREEN — the codebase is healthy in this container"
else
  echo "  ✗ RED — read the exit codes above. Do not commit until it is green."
fi

echo
echo "Done. Reminder: this container is for CODING."
echo "Whisper (medium.en, ~5GB RAM) and long renders belong on real hardware."
