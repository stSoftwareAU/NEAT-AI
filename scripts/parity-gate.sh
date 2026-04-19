#!/usr/bin/env bash
# Parity gate — verify NEAT-AI against the pinned NEAT-AI-core release
# before any in-tree native Rust is removed.
#
# Issue #2345 — block removal of in-tree duplicate Rust until:
#   1. The Rust test suite in `wasm_activation` passes against the
#      `neat-core` dependency pinned in the root `Cargo.toml`.
#   2. The TypeScript/Deno parity tests that exercise the native/WASM
#      scoring path pass (currently `test/score/WasmJsScoreParity.ts`
#      and `test/costs/MSE.ts`).
#   3. The core dependency policy invariants still hold
#      (`test/scripts/CoreDependencyPolicy.ts`).
#
# The gate is deliberately narrow: it exercises only the code paths that
# could regress when switching from in-tree crates to the external
# `neat-core`. The full `./quality.sh` gate remains the release-wide
# check; this script is a focused pre-removal gate suitable for CI and
# local sign-off.
#
# Usage:
#   scripts/parity-gate.sh              # run every gate step
#   scripts/parity-gate.sh --skip-rust  # skip Rust/cargo test (e.g. no toolchain)
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

# Ensure common toolchain locations are on PATH (mirrors quality.sh).
export PATH="$HOME/.deno/bin:$HOME/.cargo/bin:$PATH"

SKIP_RUST=false
SKIP_DENO=false
DRY_RUN=false

show_help() {
  cat <<'HELP'
Usage: scripts/parity-gate.sh [OPTIONS]

Verify NEAT-AI against the pinned NEAT-AI-core release before removing
in-tree duplicate Rust. Runs a focused subset of the quality gate
covering only the native-parity surface.

Options:
  --help, -h      Show this message and exit
  --skip-rust     Skip the `cargo test` step in wasm_activation
  --skip-deno     Skip the Deno parity and policy tests
  --dry-run       Print the steps that would run without executing them

Steps (default, all enabled):
  [1/3] Core dependency policy (test/scripts/CoreDependencyPolicy.ts)
  [2/3] Rust tests against pinned neat-core (cargo test in wasm_activation)
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
    --skip-rust)
      SKIP_RUST=true
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
RUN_RUST=true
RUN_DENO=true

if [ "$SKIP_RUST" = true ]; then
  RUN_RUST=false
fi
if [ "$SKIP_DENO" = true ]; then
  RUN_POLICY=false
  RUN_DENO=false
fi

TOTAL=0
[ "$RUN_POLICY" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_RUST" = true ] && TOTAL=$((TOTAL + 1))
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
  [ "$RUN_RUST" = true ] && progress "Rust tests in wasm_activation against pinned neat-core"
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

if [ "$RUN_RUST" = true ]; then
  progress "Rust tests in wasm_activation against pinned neat-core..."
  # Fail fast on warnings so a dependency bump cannot smuggle in regressions.
  export RUSTFLAGS="${RUSTFLAGS:--D warnings}"
  (
    cd wasm_activation
    cargo test --lib --tests
  )
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
