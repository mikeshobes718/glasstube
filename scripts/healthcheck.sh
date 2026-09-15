#!/bin/bash
# Daily GlassTube health check.
#
# Runs the self test against production and stays silent unless something is
# actually wrong. The point is to find out that YouTube moved something on a
# Tuesday morning, rather than while standing in the kitchen wearing glasses.
#
# Installed as a launchd agent; see scripts/install-healthcheck.sh.
# Run it by hand any time:  bash scripts/healthcheck.sh
#
# Browser checks are skipped here on purpose. They need playwright-core, which
# is not worth depending on for an unattended job - the API, resolve, pairing
# and push-round-trip checks are the ones that catch a real outage.

set -uo pipefail

# When installed this sits in ~/Library/Application Support/GlassTube with its
# own copy of selftest.mjs; run from the repo it just finds the repo copy.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$HOME/Library/Logs/glasstube-health.log"
mkdir -p "$(dirname "$LOG")"

# launchd hands us a minimal PATH, so find node where Homebrew and nvm put it.
for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.nvm/versions/node"/*/bin; do
  [ -x "$dir/node" ] && PATH="$dir:$PATH" && break
done
export PATH

stamp() { date "+%Y-%m-%d %H:%M:%S"; }

if ! command -v node >/dev/null 2>&1; then
  echo "$(stamp)  SKIP  node not found on PATH" >> "$LOG"
  exit 0
fi

OUT="$(cd "$ROOT" && node scripts/selftest.mjs --no-browser 2>&1)"
STATUS=$?
CLEAN="$(printf '%s' "$OUT" | sed $'s/\033\\[[0-9;]*m//g')"

{
  echo "----- $(stamp) -----"
  printf '%s\n' "$CLEAN"
} >> "$LOG"

if [ $STATUS -ne 0 ]; then
  FAILED="$(printf '%s' "$CLEAN" | grep '^  FAIL' | sed 's/^  FAIL  */- /' | head -4)"
  SUMMARY="$(printf '%s' "$FAILED" | tr '\n' ' ' | cut -c1-180)"
  osascript -e "display notification \"${SUMMARY//\"/\'}\" with title \"GlassTube check failed\" subtitle \"Open the log for detail\" sound name \"Basso\"" >/dev/null 2>&1
fi

# Keep the log from growing without bound.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 4000 ]; then
  tail -2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

exit 0
