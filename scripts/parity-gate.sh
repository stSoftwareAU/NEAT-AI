#!/usr/bin/env bash
# Parity gate — verify NEAT-AI against the pinned NEAT-AI-core release.
#
# Usage:
#   scripts/parity-gate.sh              # run every gate step
#   scripts/parity-gate.sh --skip-sync  # skip WASM package sync/build.sh step
#   scripts/parity-gate.sh --skip-deno  # skip Deno parity tests
#   scripts/parity-gate.sh --dry-run    # list the steps without running
#   scripts/parity-gate.sh --help
#
# Exit codes:
#   0  all enabled steps passed
#   1  a step failed or an unknown option was supplied

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

export PATH="$HOME/.deno/bin:$PATH"

SKIP_SYNC=false
SKIP_DENO=false
DRY_RUN=false

show_help() {
  cat <<'HELP'
Usage: scripts/parity-gate.sh [OPTIONS]

Verify NEAT-AI against the pinned NEAT-AI-core release.
Runs a focused subset of the quality gate for WASM parity.

Options:
  --help, -h      Show this message and exit
  --skip-sync     Skip the `./build.sh` WASM sync step
  --skip-deno     Skip the Deno parity and policy tests
  --dry-run       Print the steps that would run without executing them

Steps (default, all enabled):
  [1/3] Core dependency policy (test/scripts/CoreDependencyPolicy.ts)
  [2/3] Sync WASM package from pinned neatCore.rev (./build.sh)
  [3/3] TypeScript/Deno parity tests (WasmJsScoreParity + MSE)

Exit codes:
  0   All enabled steps passed
  1   A step failed or an unknown option was provided
HELP
}

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      show_help
      exit 0
      ;;
    --skip-sync)
      SKIP_SYNC=true
      ;;
    --skip-deno)
      SKIP_DENO=true
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Run 'scripts/parity-gate.sh --help' for usage." >&2
      exit 1
      ;;
  esac
done

RUN_POLICY=true
RUN_SYNC=true
RUN_DENO=true

if [ "$SKIP_SYNC" = true ]; then
  RUN_SYNC=false
fi
if [ "$SKIP_DENO" = true ]; then
  RUN_POLICY=false
  RUN_DENO=false
fi

TOTAL=0
[ "$RUN_POLICY" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_SYNC" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_DENO" = true ] && TOTAL=$((TOTAL + 1))

STEP=0
progress() {
  STEP=$((STEP + 1))
  echo ""
  echo "[$STEP/$TOTAL] $1"
}

if [ "$DRY_RUN" = true ]; then
  echo "DRY RUN — the following parity-gate steps would execute:"
  echo ""
  [ "$RUN_POLICY" = true ] && progress "Core dependency policy check"
  [ "$RUN_SYNC" = true ] && progress "WASM package sync from NEAT-AI-core pin"
  [ "$RUN_DENO" = true ] && progress "Deno parity tests (WASM/JS scoring + MSE)"
  echo ""
  echo "Total: $TOTAL step(s)"
  exit 0
fi

cd "$REPO_ROOT"

if [ "$RUN_POLICY" = true ]; then
  progress "Core dependency policy check..."
  deno test --no-check --config ./deno.json \
    --allow-read \
    test/scripts/CoreDependencyPolicy.ts
fi

if [ "$RUN_SYNC" = true ]; then
  progress "WASM package sync from NEAT-AI-core pin..."
  ./build.sh
fi

if [ "$RUN_DENO" = true ]; then
  progress "Deno parity tests (WASM score parity + MSE cost)..."
  deno test --config ./deno.json \
    --allow-read \
    --allow-env \
    --allow-ffi \
    test/score/WasmJsScoreParity.ts \
    test/costs/MSE.ts
fi

echo ""
echo "✅ Parity gate passed ($TOTAL step(s))."
