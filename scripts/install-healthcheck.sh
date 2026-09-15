#!/bin/bash
# Install (or remove) the daily GlassTube health check as a launchd agent.
#
#   bash scripts/install-healthcheck.sh            # install, runs daily 9:07am
#   bash scripts/install-healthcheck.sh --remove   # uninstall
#
# launchd rather than a cloud job on purpose: the check needs no credentials,
# it only talks to public endpoints, and nothing leaves this Mac. The tradeoff
# is that it runs when the Mac is awake - if it is asleep at 9:07, launchd runs
# it at the next wake.
#
# The scripts are COPIED to ~/Library/Application Support/GlassTube rather than
# run from the repo. macOS refuses launchd agents access to ~/Documents without
# Full Disk Access, and the check needs nothing from the repo at run time - it
# only talks to production over HTTPS. Re-run this installer after changing
# selftest.mjs to refresh the copy.

set -euo pipefail

LABEL="com.mikeshobes.glasstube.healthcheck"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="$HOME/Library/Application Support/GlassTube"

if [ "${1:-}" = "--remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$HOME_DIR"
  echo "Removed $LABEL"
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME_DIR/scripts"
cp "$REPO/scripts/selftest.mjs" "$HOME_DIR/scripts/selftest.mjs"
cp "$REPO/scripts/healthcheck.sh" "$HOME_DIR/scripts/healthcheck.sh"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$HOME_DIR/scripts/healthcheck.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>9</integer>
    <key>Minute</key><integer>7</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/glasstube-health.out</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/glasstube-health.out</string>
</dict>
</plist>
PLISTEOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed $LABEL - runs daily at 9:07am"
echo "  copy of: $HOME_DIR/scripts"
echo "  log:     ~/Library/Logs/glasstube-health.log"
echo "  run now: launchctl kickstart -k gui/$(id -u)/$LABEL"
echo "  remove:  bash scripts/install-healthcheck.sh --remove"
