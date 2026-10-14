#!/bin/sh
# Run a migration on Berth one statement at a time (Berth accepts one per
# request). Statements are separated by lines reading exactly "-- @@"; the
# header before the first separator is skipped.
#   sh scripts/sql/run-berth.sh scripts/sql/2026-10-delivery.sql [app]
set -e
FILE="$1"; APP="${2:-glasstube}"
python3 - "$FILE" "$APP" <<'PY'
import subprocess, sys
path, app = sys.argv[1], sys.argv[2]
parts = open(path).read().split('\n-- @@\n')[1:]
for i, stmt in enumerate(parts, 1):
    stmt = stmt.strip()
    if not stmt:
        continue
    first = stmt.splitlines()[0][:70]
    r = subprocess.run(['berth', 'sql', '--app', app, '-f', '-'], input=stmt, text=True, capture_output=True)
    print(f'[{i}/{len(parts)}] {first} -> ' + ('ok' if r.returncode == 0 else 'FAILED'))
    if r.returncode != 0:
        print(r.stdout + r.stderr)
        sys.exit(1)
PY
