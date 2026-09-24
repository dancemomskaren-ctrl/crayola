#!/bin/bash
# Crayola verification gate.
#
# Prints the REAL exit codes for typecheck and test, and exits non-zero if either
# fails, so a red result can never look green. Wired to the VS Code task "Verify"
# (Cmd+Shift+B) and safe to run by hand any time.
#
# Usage:  ./scripts/verify.sh

set -u
cd "$(dirname "$0")/.." || exit 1

TC_LOG="${TMPDIR:-/tmp}/crayola-typecheck.log"
TS_LOG="${TMPDIR:-/tmp}/crayola-test.log"

echo "▶ typecheck (bun run typecheck)"
bun run typecheck > "$TC_LOG" 2>&1
TC=$?

echo "▶ test (bun run test)"
bun run test > "$TS_LOG" 2>&1
TS=$?

echo
echo "================================================"
echo "  TYPECHECK EXIT: $TC"
echo "  TEST EXIT:      $TS"
echo "================================================"
echo "--- typecheck (last 15) ---"
tail -15 "$TC_LOG"
echo "--- test (last 25) ---"
tail -25 "$TS_LOG"
echo

if [ "$TC" -eq 0 ] && [ "$TS" -eq 0 ]; then
  echo "RESULT: GREEN — safe to commit."
  exit 0
fi

echo "RESULT: RED — do NOT commit."
echo "Full logs: $TC_LOG  $TS_LOG"
exit 1
