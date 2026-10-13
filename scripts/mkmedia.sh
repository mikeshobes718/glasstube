#!/bin/sh
# Test media for scripts/hudshot.mjs --media. Needs ffmpeg.
#   sh scripts/mkmedia.sh [/tmp/glasstube-media]
# v169.webm 16:9 20s, vbright.webm bright bars 20s, vshort.webm 9:16 20s. VP9 + Opus,
# because Playwright's Chromium has no H.264. The harness maps a requested
# v169.mp4 to v169.webm, so commands written for .mp4 still work.
set -e
D="${1:-${GLASSTUBE_MEDIA:-/tmp/glasstube-media}}"
mkdir -p "$D"
mk() { ffmpeg -loglevel error -y -f lavfi -i "$1" -f lavfi -i "sine=f=$2:d=20" -c:v libvpx-vp9 -b:v 300k \
  -deadline realtime -cpu-used 8 -c:a libopus -shortest "$D/$3"; }
mk "testsrc2=s=640x360:r=30:d=20" 440 v169.webm
mk "smptehdbars=s=640x360:r=30:d=20" 660 vbright.webm
mk "testsrc2=s=360x640:r=30:d=20" 330 vshort.webm
ls -la "$D"
