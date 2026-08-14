#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.deno/bin:$PATH"

SKIP_TESTS=false
SKIP_DISCOVERY=false
SKIP_WASM=false
LINT_ONLY=false
CHECK_ONLY=false
DRY_RUN=false
WASM_SCORER=false
NEXT=false
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
  --wasm-scorer       Comparison-only: run tests on the legacy WASM scorer
                      instead of rust_scorer. Remove this once the WASM
                      scoring path is deleted.
  --next              Run the existing handwritten test suite against native
                      libneat_core topological backprop (Issue #3741). Same
                      idea as the Rust scorer: tests are not rewritten; the
                      implementation swaps underneath. WASM backprop stays
                      the default until this suite is green and a bench
                      shows a win. Does not spawn the trainDir CLI.
  --test-both-scorers Run tests twice: WASM scorer then Rust scorer
  --rust-scorer-bin=PATH
                      Path to rust_scorer binary (default: rust_scorer)
  --rust-scorer-timeout-ms=MS
                      Timeout for scorer process calls (default: 0)
  --lint-only         Only run formatting + linting (includes bash check)
  --check-only        Only run type-checking (deno check)
  --dry-run           Show which steps would run without executing them

Environment:
  VIBE_BUMP_QUARANTINE_HOURS
                      Minimum age (hours) of registry versions accepted by
                      `deno outdated --update --latest`. Default 24h. Mirrors
                      bump-deps.sh; dodges fast-flagged supply-chain attacks
                      (Issue #2742). Must be a non-negative integer.
  NEAT_AI_NATIVE_CORE_BACKPROP
                      Set to 1 to build sibling libneat_core and use native
                      topological backprop (Issue #3741). `./quality.sh --next`
                      sets this. Default: WASM packed loop.
  NEAT_AI_BACKPROP_ENABLED
                      Set to 1 to spawn sibling neat_ai_backpropagation from
                      trainDir. Separate from --next; keep off until the
                      native loop is proven. Default: off.
  DENO_JOBS
                      Parallel `deno test` workers. Default: sized so each
                      worker can keep an 8192 MB V8 heap. Leave 12 GiB for
                      the OS/editor. A 24 GB laptop gets 1 worker. Honour an
                      explicit DENO_JOBS and shrink the heap instead.
  NEAT_AI_TEST_HEAP_MB
                      V8 old-space size in MB for `deno test`. Default: 8192.
                      Do not drop this below ~8 GB for the full suite — a
                      4096 MB cap SIGTRAPs evolve tests that sit above 4 GB.
  QUALITY_TRACE_LEAKS
                      `1` forces `deno test --trace-leaks`; `0` disables it.
                      Default: on only when the host has ≥ 32 GiB RAM.
                      `--trace-leaks` retains every allocation until each
                      test ends, so evolve tests jetsam 24 GB laptops.

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
    --wasm-scorer) WASM_SCORER=true ;;
    --next) NEXT=true ;;
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

if [ "$NEXT" = true ]; then
  export NEAT_AI_NATIVE_CORE_BACKPROP=1
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

host_memory_mb() {
  case "$(uname -s)" in
    Darwin)
      local bytes
      bytes="$(sysctl -n hw.memsize 2>/dev/null)" || return 1
      echo $((bytes / 1024 / 1024))
      ;;
    Linux)
      awk '/MemTotal:/ { print int($2 / 1024); exit }' /proc/meminfo
      ;;
    *)
      return 1
      ;;
  esac
}

# Two failure modes, opposite levers:
#   jetsam / SIGKILL 137 — too many workers (4 × 8192 MB on a 24 GB laptop).
#   V8 SIGTRAP 133     — heap cap below what a single evolve test needs
#                         (~4060 MB used / 4192 MB limit on --wasm-scorer).
# Default: keep an 8192 MB heap and drop DENO_JOBS so workers fit in
# (RAM − 12 GiB). A 24 GB laptop gets 1 × 8192 MB.
QUALITY_OS_RESERVE_MB=12288
QUALITY_MAX_JOBS=2
QUALITY_HEAP_MB=8192

compute_test_jobs() {
  if [ -n "${DENO_JOBS:-}" ]; then
    echo "$DENO_JOBS"
    return
  fi
  local total usable jobs
  total="$(host_memory_mb)" || {
    echo 1
    return
  }
  usable=$((total - QUALITY_OS_RESERVE_MB))
  if [ "$usable" -lt "$QUALITY_HEAP_MB" ]; then
    echo 1
    return
  fi
  jobs=$((usable / QUALITY_HEAP_MB))
  if [ "$jobs" -gt "$QUALITY_MAX_JOBS" ]; then
    jobs=$QUALITY_MAX_JOBS
  fi
  if [ "$jobs" -lt 1 ]; then
    jobs=1
  fi
  echo "$jobs"
}

compute_test_heap_mb() {
  if [ -n "${NEAT_AI_TEST_HEAP_MB:-}" ]; then
    echo "$NEAT_AI_TEST_HEAP_MB"
    return
  fi
  # Default jobs: always the 8192 MB the suite needs.
  if [ -z "${DENO_JOBS:-}" ]; then
    echo "$QUALITY_HEAP_MB"
    return
  fi
  # Explicit DENO_JOBS: shrink the heap so workers still fit, but never
  # below 2048 MB.
  local total jobs usable heap
  total="$(host_memory_mb)" || {
    echo "$QUALITY_HEAP_MB"
    return
  }
  jobs="${TEST_JOBS:-1}"
  if [ "$jobs" -lt 1 ]; then
    jobs=1
  fi
  usable=$((total - QUALITY_OS_RESERVE_MB))
  if [ "$usable" -lt 2048 ]; then
    usable=2048
  fi
  heap=$((usable / jobs))
  if [ "$heap" -gt "$QUALITY_HEAP_MB" ]; then
    heap=$QUALITY_HEAP_MB
  fi
  if [ "$heap" -lt 2048 ]; then
    heap=2048
  fi
  echo "$heap"
}

TEST_JOBS="$(compute_test_jobs)"
TEST_HEAP_MB="$(compute_test_heap_mb)"

QUALITY_TRACE_LEAKS_MIN_RAM_MB=32768

should_trace_leaks() {
  case "${QUALITY_TRACE_LEAKS:-}" in
    0) return 1 ;;
    1) return 0 ;;
  esac
  local total
  total="$(host_memory_mb)" || return 1
  [ "$total" -ge "$QUALITY_TRACE_LEAKS_MIN_RAM_MB" ]
}

if should_trace_leaks; then
  TRACE_LEAKS_STATE="on"
else
  TRACE_LEAKS_STATE="off"
fi

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
  # Native backprop is opt-in (Issue #3741). WASM is the default path.
  if [[ "${NEAT_AI_NATIVE_CORE_BACKPROP:-}" == "1" && -d ../NEAT-AI-core ]]; then
    TOTAL=$((TOTAL + 1))
  fi
  if [[ "${NEAT_AI_BACKPROP_ENABLED:-}" == "1" && -d ../NEAT-AI-Backpropagation ]]; then
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
    if [[ "${NEAT_AI_NATIVE_CORE_BACKPROP:-}" == "1" && -d ../NEAT-AI-core ]]; then
      progress "Building native neat-core library..."
    fi
    if [[ "${NEAT_AI_BACKPROP_ENABLED:-}" == "1" && -d ../NEAT-AI-Backpropagation ]]; then
      progress "Building native neat_ai_backpropagation..."
    fi
    if [ "$TEST_BOTH_SCORERS" = true ]; then
      progress "Running tests (WASM scorer mode)..."
      progress "Running tests (Rust scorer mode)..."
    elif [ "$WASM_SCORER" = true ]; then
      if [ "$NEXT" = true ]; then
        progress "Running tests (--next native backprop, WASM scorer)..."
      else
        progress "Running tests (WASM scorer mode)..."
      fi
    elif [ "$NEXT" = true ]; then
      progress "Running tests (--next native backprop, Rust scorer)..."
    else
      progress "Running tests (Rust scorer mode)..."
    fi
    echo "V8 heap ${TEST_HEAP_MB} MB × DENO_JOBS=${TEST_JOBS} (leak tracing: ${TRACE_LEAKS_STATE})"
  fi
  echo ""
  echo "Total: $TOTAL steps"
  exit 0
fi

run_test_suite() {
  local scorer_mode="$1"
  local -a env_args=(
    "DENO_JOBS=${TEST_JOBS}"
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

  if [ "$NEXT" = true ]; then
    env_args+=("NEAT_AI_NATIVE_CORE_BACKPROP=1")
  fi

  echo "V8 heap ${TEST_HEAP_MB} MB × DENO_JOBS=${TEST_JOBS} (leak tracing: ${TRACE_LEAKS_STATE})"
  local -a deno_args=(
    --allow-read
    --allow-write
    --allow-net
    --allow-env
    --allow-run
    --allow-ffi
    --v8-flags=--max-old-space-size="${TEST_HEAP_MB}"
    --parallel
    --preload
    test/_preload.ts
    --config
    ./deno.json
  )
  if [ "$TRACE_LEAKS_STATE" = "on" ]; then
    deno_args+=(--trace-leaks)
  fi
  env "${env_args[@]}" deno test "${deno_args[@]}"
}

if [ "$RUN_DEPS" = true ]; then
  progress "Updating dependencies..."
  # Mirror the quarantine window enforced by bump-deps.sh / docs/CORE_DEPENDENCY_POLICY.md
  # (Issue #2742). Without --minimum-dependency-age, a malicious registry version
  # published minutes ago could be pulled in by a routine `./quality.sh` run before
  # the supply-chain quarantine window expires.
  QUALITY_QUARANTINE_HOURS="${VIBE_BUMP_QUARANTINE_HOURS:-24}"
  if ! [[ "$QUALITY_QUARANTINE_HOURS" =~ ^[0-9]+$ ]]; then
    echo "ERROR: VIBE_BUMP_QUARANTINE_HOURS must be a non-negative integer, got '$QUALITY_QUARANTINE_HOURS'" >&2
    exit 1
  fi
  QUALITY_QUARANTINE_MINUTES=$((QUALITY_QUARANTINE_HOURS * 60))
  deno outdated --update --latest \
    "--minimum-dependency-age=${QUALITY_QUARANTINE_MINUTES}"
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

if [ "$RUN_TESTS" = true ] && [[ "${NEAT_AI_NATIVE_CORE_BACKPROP:-}" == "1" ]]; then
  if [[ -d ../NEAT-AI-core ]]; then
    progress "Building native neat-core library..."
    (cd ../NEAT-AI-core && cargo build --release -p neat-core)
  elif [ "$NEXT" = true ]; then
    echo "⚠️  --next: ../NEAT-AI-core is not checked out; topological backprop stays on WASM."
  fi
fi

if [ "$RUN_TESTS" = true ] && [[ "${NEAT_AI_BACKPROP_ENABLED:-}" == "1" ]]; then
  if [[ -d ../NEAT-AI-Backpropagation ]]; then
    progress "Building native neat_ai_backpropagation..."
    (cd ../NEAT-AI-Backpropagation && cargo build --release -p neat_ai_backpropagation)
  elif [ "$NEXT" = true ]; then
    echo "⚠️  NEAT_AI_BACKPROP_ENABLED=1 but ../NEAT-AI-Backpropagation is not checked out; trainDir stays on TypeScript."
  fi
fi

if [ "$RUN_WASM" = true ]; then
  progress "Syncing WASM package from NEAT-AI-core..."
  # Use --verify-only: CI must not auto-advance neatCore.rev. Bumping is
  # an explicit ./build.sh invocation by a human or worker (see
  # docs/CORE_DEPENDENCY_POLICY.md, issue #2433).
  ./build.sh --verify-only
fi

if [ "$RUN_TESTS" = true ]; then
  if [ "$TEST_BOTH_SCORERS" = true ]; then
    progress "Running tests (WASM scorer mode)..."
    run_test_suite "wasm"
    progress "Running tests (Rust scorer mode)..."
    run_test_suite "rust"
  elif [ "$WASM_SCORER" = true ]; then
    if [ "$NEXT" = true ]; then
      progress "Running tests (--next native backprop, WASM scorer)..."
    else
      progress "Running tests (WASM scorer mode)..."
    fi
    run_test_suite "wasm"
  elif [ "$NEXT" = true ]; then
    progress "Running tests (--next native backprop, Rust scorer)..."
    run_test_suite "rust"
  else
    progress "Running tests (Rust scorer mode)..."
    run_test_suite "rust"
  fi
fi
