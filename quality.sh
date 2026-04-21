#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.deno/bin:$PATH"

SKIP_TESTS=false
SKIP_DISCOVERY=false
SKIP_WASM=false
LINT_ONLY=false
CHECK_ONLY=false
DRY_RUN=false
WITH_RUST_SCORER=false
TEST_BOTH_SCORERS=false
RUST_SCORER_BINARY_PATH="${NEAT_AI_RUST_SCORER_BINARY_PATH:-rust_scorer}"
RUST_SCORER_TIMEOUT_MS="${NEAT_AI_RUST_SCORER_TIMEOUT_MS:-0}"

show_help() {
  cat <<'HELP'
Usage: ./quality.sh [OPTIONS]

Pre-commit quality gate that runs formatting, linting, type-checking,
discovery verification, WASM sync, and all tests.

Options:
  --help, -h          Show this help message and exit
  --skip-tests        Skip test execution
  --skip-discovery    Skip discovery library build and verification
  --skip-wasm         Skip WASM package sync from NEAT-AI-core
  --with-rust-scorer  Enable external Rust scorer during test execution
  --test-both-scorers Run tests twice: WASM-only then Rust scorer enabled
  --rust-scorer-bin=PATH
                      Path to rust_scorer binary (default: rust_scorer)
  --rust-scorer-timeout-ms=MS
                      Timeout for scorer process calls (default: 0)
  --lint-only         Only run formatting + linting (includes bash check)
  --check-only        Only run type-checking (deno check)
  --dry-run           Show which steps would run without executing them

Exit codes:
  0   All enabled steps passed
  1   A step failed or an unknown option was provided
HELP
}

for arg in "$@"; do
  case "$arg" in
    --help|-h) show_help; exit 0 ;;
    --skip-tests) SKIP_TESTS=true ;;
    --skip-discovery) SKIP_DISCOVERY=true ;;
    --skip-wasm) SKIP_WASM=true ;;
    --with-rust-scorer) WITH_RUST_SCORER=true ;;
    --test-both-scorers) TEST_BOTH_SCORERS=true ;;
    --rust-scorer-bin=*) RUST_SCORER_BINARY_PATH="${arg#*=}" ;;
    --rust-scorer-timeout-ms=*) RUST_SCORER_TIMEOUT_MS="${arg#*=}" ;;
    --lint-only) LINT_ONLY=true ;;
    --check-only) CHECK_ONLY=true ;;
    --dry-run) DRY_RUN=true ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Run './quality.sh --help' for usage information." >&2
      exit 1
      ;;
  esac
done

if [ -z "$RUST_SCORER_BINARY_PATH" ]; then
  echo "rust scorer binary path must not be empty" >&2
  exit 1
fi

RUN_DEPS=true
RUN_FMT=true
RUN_LINT=true
RUN_BASH_CHECK=true
RUN_TYPE_CHECK=true
RUN_DISCOVERY=true
RUN_WASM=true
RUN_TESTS=true

if [ "$LINT_ONLY" = true ]; then
  RUN_TYPE_CHECK=false
  RUN_DISCOVERY=false
  RUN_WASM=false
  RUN_TESTS=false
fi

if [ "$CHECK_ONLY" = true ]; then
  RUN_DEPS=false
  RUN_FMT=false
  RUN_LINT=false
  RUN_BASH_CHECK=false
  RUN_DISCOVERY=false
  RUN_WASM=false
  RUN_TESTS=false
fi

[ "$SKIP_TESTS" = true ] && RUN_TESTS=false
[ "$SKIP_DISCOVERY" = true ] && RUN_DISCOVERY=false
[ "$SKIP_WASM" = true ] && RUN_WASM=false

TOTAL=0
[ "$RUN_DEPS" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_FMT" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_LINT" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_BASH_CHECK" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_TYPE_CHECK" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_DISCOVERY" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_WASM" = true ] && TOTAL=$((TOTAL + 1))
if [ "$RUN_TESTS" = true ]; then
  if [ "$TEST_BOTH_SCORERS" = true ]; then
    TOTAL=$((TOTAL + 2))
  else
    TOTAL=$((TOTAL + 1))
  fi
fi

STEP=0
progress() {
  STEP=$((STEP + 1))
  echo ""
  echo "[$STEP/$TOTAL] $1"
}

if [ "$DRY_RUN" = true ]; then
  echo "DRY RUN — the following steps would be executed:"
  echo ""
  [ "$RUN_DEPS" = true ] && progress "Updating dependencies..."
  [ "$RUN_FMT" = true ] && progress "Formatting code..."
  [ "$RUN_LINT" = true ] && progress "Linting..."
  [ "$RUN_BASH_CHECK" = true ] && progress "Checking bash scripts..."
  [ "$RUN_TYPE_CHECK" = true ] && progress "Type-checking..."
  [ "$RUN_DISCOVERY" = true ] && progress "Building discovery library..."
  [ "$RUN_WASM" = true ] && progress "Syncing WASM package from NEAT-AI-core..."
  if [ "$RUN_TESTS" = true ]; then
    if [ "$TEST_BOTH_SCORERS" = true ]; then
      progress "Running tests (WASM-only scorer mode)..."
      progress "Running tests (Rust scorer mode)..."
    elif [ "$WITH_RUST_SCORER" = true ]; then
      progress "Running tests (Rust scorer mode)..."
    else
      progress "Running tests (WASM-only scorer mode)..."
    fi
  fi
  echo ""
  echo "Total: $TOTAL steps"
  exit 0
fi

run_test_suite() {
  local scorer_mode="$1"
  local -a env_args=(
    "DENO_JOBS=${DENO_JOBS:-4}"
    "NEAT_AI_DISCOVERY_DETERMINISTIC=1"
  )

  if [ "$scorer_mode" = "rust" ]; then
    env_args+=(
      "NEAT_AI_RUST_SCORER_ENABLED=1"
      "NEAT_AI_RUST_SCORER_BINARY_PATH=$RUST_SCORER_BINARY_PATH"
      "NEAT_AI_RUST_SCORER_TIMEOUT_MS=$RUST_SCORER_TIMEOUT_MS"
    )
  else
    env_args+=("NEAT_AI_RUST_SCORER_ENABLED=0")
  fi

  env "${env_args[@]}" deno test \
    --allow-read \
    --allow-write \
    --allow-net \
    --allow-env \
    --allow-run \
    --trace-leaks \
    --allow-ffi \
    --v8-flags=--max-old-space-size=8192 \
    --parallel \
    --preload test/_preload.ts \
    --config ./deno.json
}

if [ "$RUN_DEPS" = true ]; then
  progress "Updating dependencies..."
  deno outdated --update --latest
fi

if [ "$RUN_FMT" = true ]; then
  progress "Formatting code..."
  deno fmt
fi

if [ "$RUN_LINT" = true ]; then
  progress "Linting..."
  deno lint --fix src test bench mod.ts
fi

if [ "$RUN_BASH_CHECK" = true ]; then
  progress "Checking bash scripts..."
  fail=0
  while IFS= read -r f; do
    if ! bash -n "$f"; then
      echo "❌ syntax error in $f" >&2
      fail=1
    else
      echo "✅ $f"
    fi
  done < <(find . -name "*.sh" -type f -not -path "./.git/*")

  if [ $fail -eq 1 ]; then
    echo "❌ Bash script syntax errors found"
    exit 1
  fi
fi

if [ "$RUN_TYPE_CHECK" = true ]; then
  progress "Type-checking..."
  rm -rf .trace .test .coverage
  deno check
fi

if [ "$RUN_DISCOVERY" = true ]; then
  progress "Building discovery library..."
  if [[ -d ../NEAT-AI-Discovery ]]; then
    (cd ../NEAT-AI-Discovery && ./scripts/runlib.sh)
  fi

  echo "Verifying discovery library availability..."
  exit_code=0
  deno run \
    --allow-read \
    --allow-env \
    --allow-ffi \
    --config ./deno.json \
    scripts/check_discovery_safe.ts 2>&1 || exit_code=$?
  if [ $exit_code -ne 0 ]; then
    if [ $exit_code -eq 137 ] || [ $exit_code -eq 9 ]; then
      echo ""
      echo "❌ Discovery library crashed on load (Killed: 9 or exit code 137)"
      echo "   This indicates a fatal crash in the discovery native library."
      exit 1
    elif [[ -d ../NEAT-AI-Discovery ]]; then
      echo "❌ Discovery checks failed (exit code: $exit_code)"
      exit 1
    else
      echo "⚠️  Discovery library not found and NEAT-AI-Discovery project is not available."
      echo "   Skipping verification. To enable, clone NEAT-AI-Discovery next to this repo."
    fi
  fi
fi

if [ "$RUN_WASM" = true ]; then
  progress "Syncing WASM package from NEAT-AI-core..."
  ./build.sh
fi

if [ "$RUN_TESTS" = true ]; then
  if [ "$TEST_BOTH_SCORERS" = true ]; then
    progress "Running tests (WASM-only scorer mode)..."
    run_test_suite "wasm"
    progress "Running tests (Rust scorer mode)..."
    run_test_suite "rust"
  elif [ "$WITH_RUST_SCORER" = true ]; then
    progress "Running tests (Rust scorer mode)..."
    run_test_suite "rust"
  else
    progress "Running tests (WASM-only scorer mode)..."
    run_test_suite "wasm"
  fi
fi
