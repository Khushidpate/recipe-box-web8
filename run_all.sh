#!/usr/bin/env bash
# Runs every Version 8 web test. From the web/ folder:  bash tests/run_all.sh
set -u
cd "$(dirname "$0")/.."
echo "== Unit tests (Node) =="
node --test tests/*.test.js 2>&1 | grep -E "^(not ok|# (pass|fail))"; unit=${PIPESTATUS[0]}
python3 -m http.server 8765 >/dev/null 2>&1 &
srv=$!
trap 'kill $srv 2>/dev/null' EXIT
sleep 1
status=$unit
for t in tests/e2e_*.py; do
  echo; echo "== $(basename "$t") =="
  python3 "$t" || status=1
done
exit $status
