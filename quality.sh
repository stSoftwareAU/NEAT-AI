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
RUST_SCORER_BINARY_EXPLICIT=false
if [ -n "${NEAT_AI_RUST_SCORER_BINARY_PATH:-}" ]; then
  RUST_SCORER_BINARY_EXPLICIT=true
fi

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
                      Fails loud if libneat_core cannot be loaded (no WASM
                      fallback).
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
                      Leftover exports are ignored when --wasm-scorer is set
                      (unless --next is also passed).
  NEAT_AI_BACKPROP_ENABLED
                      Set to 1 to spawn sibling neat_ai_backpropagation from
                      trainDir. Separate from --next; keep off until the
                      native loop is proven. Default: off.
  DENO_JOBS
                      Parallel `deno test` workers. Default: sized so each
                      worker can keep an 8192 MB V8 heap (evolve tests sit
                      above 4 GB). Leave 12 GiB for the OS/editor. A 24 GB
                      laptop gets 1 worker; shrinking the heap to 4096 MB
                      causes V8 SIGTRAP, not a smaller RSS. Honour an
                      explicit DENO_JOBS and shrink the heap instead.
  NEAT_AI_TEST_HEAP_MB
                      V8 old-space size in MB for `deno test`. Default: 8192.
                      Do not drop this below ~8 GB for the full suite.
  NEAT_AI_IN_FLIGHT_DIR
                      Directory of in-flight `Deno.test` name files (default:
                      `.quality-in-flight`). `deno test --parallel` only
                      prints a file when it finishes; leftover files after a
                      SIGKILL name the cases that were still running.

Native gates (fail loud, no silent WASM fallback):
  rust_scorer is required for the default test run. The gate fails if the
  binary cannot be resolved (PATH, --rust-scorer-bin, sibling
  ../NEAT-AI-scorer). Use --wasm-scorer only for a comparison run.
  Test runs force NEAT_SCORER_GPU=off so parallel rust_scorer processes do
  not create Metal/wgpu contexts (the default --gpu auto path OOMs the suite).
  --wasm-scorer forces native backprop off so a leftover operator export
  cannot load libneat_core on the comparison run.
  --next / NEAT_AI_NATIVE_CORE_BACKPROP=1 requires native libneat_core.
  NEAT_AI_BACKPROP_ENABLED=1 requires neat_ai_backpropagation.

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
    --rust-scorer-bin=*)
      RUST_SCORER_BINARY_PATH="${arg#*=}"
      RUST_SCORER_BINARY_EXPLICIT=true
      ;;
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

rust_scorer_wanted() {
  if [ "$RUN_TESTS" != true ]; then
    return 1
  fi
  if [ "$TEST_BOTH_SCORERS" = true ]; then
    return 0
  fi
  if [ "$WASM_SCORER" = true ]; then
    return 1
  fi
  return 0
}

native_core_backprop_wanted() {
  if [ "$RUN_TESTS" != true ]; then
    return 1
  fi
  # Explicit --next still requires libneat_core, even with --wasm-scorer.
  if [ "$NEXT" = true ]; then
    return 0
  fi
  # --wasm-scorer is a WASM comparison run. Do not pick up a leftover
  # NEAT_AI_NATIVE_CORE_BACKPROP=1 from the operator environment.
  if [ "$WASM_SCORER" = true ]; then
    return 1
  fi
  [[ "${NEAT_AI_NATIVE_CORE_BACKPROP:-}" == "1" ]]
}

native_train_dir_wanted() {
  if [ "$RUN_TESTS" != true ]; then
    return 1
  fi
  if [ "$WASM_SCORER" = true ]; then
    return 1
  fi
  [[ "${NEAT_AI_BACKPROP_ENABLED:-}" == "1" ]]
}

native_core_lib_file_name() {
  case "$(uname -s)" in
    Darwin) printf '%s\n' "libneat_core.dylib" ;;
    MINGW* | MSYS* | CYGWIN* | Windows_NT) printf '%s\n' "neat_core.dll" ;;
    *) printf '%s\n' "libneat_core.so" ;;
  esac
}

native_train_dir_file_name() {
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN* | Windows_NT) printf '%s\n' "neat_ai_backpropagation.exe" ;;
    *) printf '%s\n' "neat_ai_backpropagation" ;;
  esac
}

rust_scorer_can_be_resolved() {
  if [ "$RUST_SCORER_BINARY_EXPLICIT" = true ]; then
    [ -x "$RUST_SCORER_BINARY_PATH" ]
    return $?
  fi
  if command -v "$RUST_SCORER_BINARY_PATH" >/dev/null 2>&1; then
    return 0
  fi
  if [ -x ../NEAT-AI-scorer/target/release/rust_scorer ]; then
    return 0
  fi
  if [ -d ../NEAT-AI-scorer ]; then
    return 0
  fi
  if [ -x "${HOME}/.cargo/bin/rust_scorer" ]; then
    return 0
  fi
  return 1
}

native_core_backprop_can_be_resolved() {
  local name
  name="$(native_core_lib_file_name)"
  if [ -n "${NEAT_AI_CORE_LIB_PATH:-}" ]; then
    if [ -f "${NEAT_AI_CORE_LIB_PATH}" ] || [ -f "${NEAT_AI_CORE_LIB_PATH}/${name}" ]; then
      return 0
    fi
  fi
  if [ -f "${HOME}/.cargo/lib/${name}" ]; then
    return 0
  fi
  if [ -f "./target/release/${name}" ]; then
    return 0
  fi
  if [ -f "../NEAT-AI-core/target/release/${name}" ]; then
    return 0
  fi
  if [ -d ../NEAT-AI-core ]; then
    return 0
  fi
  return 1
}

native_train_dir_can_be_resolved() {
  local name
  name="$(native_train_dir_file_name)"
  if [ -n "${NEAT_AI_BACKPROP_BINARY_PATH:-}" ]; then
    if [ -f "${NEAT_AI_BACKPROP_BINARY_PATH}" ] ||
      [ -f "${NEAT_AI_BACKPROP_BINARY_PATH}/${name}" ]; then
      return 0
    fi
  fi
  if [ -f "./target/release/${name}" ]; then
    return 0
  fi
  if [ -f "../NEAT-AI-Backpropagation/target/release/${name}" ]; then
    return 0
  fi
  if [ -d ../NEAT-AI-Backpropagation ]; then
    return 0
  fi
  return 1
}

fail_missing_rust_scorer() {
  echo "❌ Native rust_scorer is required (quality.sh default) but was not found." >&2
  echo "   Tests will not silently fall back to the WASM scorer." >&2
  echo "" >&2
  echo "   Fix one of:" >&2
  echo "     - Clone NEAT-AI-scorer next to this repo, then cargo build --release -p rust_scorer" >&2
  echo "     - Put rust_scorer on PATH" >&2
  echo "     - Pass --rust-scorer-bin=/path/to/rust_scorer" >&2
  echo "     - Comparison-only WASM: ./quality.sh --wasm-scorer" >&2
  exit 1
}

fail_missing_native_core_backprop() {
  echo "❌ Native libneat_core backprop was requested (--next / NEAT_AI_NATIVE_CORE_BACKPROP=1)" >&2
  echo "   but the library was not found. Tests will not silently fall back to WASM." >&2
  echo "" >&2
  echo "   Fix one of:" >&2
  echo "     - Clone NEAT-AI-core next to this repo, then cargo build --release -p neat-core" >&2
  echo "     - Set NEAT_AI_CORE_LIB_PATH to the library file or its directory" >&2
  exit 1
}

fail_missing_native_train_dir() {
  echo "❌ Native neat_ai_backpropagation was requested (NEAT_AI_BACKPROP_ENABLED=1)" >&2
  echo "   but the binary was not found. trainDir will not silently stay on TypeScript." >&2
  echo "" >&2
  echo "   Fix one of:" >&2
  echo "     - Clone NEAT-AI-Backpropagation next to this repo, then cargo build --release -p neat_ai_backpropagation" >&2
  echo "     - Set NEAT_AI_BACKPROP_BINARY_PATH to the binary" >&2
  exit 1
}

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
#   jetsam / SIGKILL 137 — too many workers (4 × 8192, or rust_scorer GPU).
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
  if rust_scorer_wanted && [ "$RUST_SCORER_BINARY_EXPLICIT" != true ] &&
    [ -d ../NEAT-AI-scorer ]; then
    TOTAL=$((TOTAL + 1))
  fi
  # Native backprop is opt-in (Issue #3741). WASM is the default path.
  if native_core_backprop_wanted; then
    TOTAL=$((TOTAL + 1))
  fi
  if native_train_dir_wanted; then
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
    if rust_scorer_wanted && [ "$RUST_SCORER_BINARY_EXPLICIT" != true ] &&
      [ -d ../NEAT-AI-scorer ]; then
      progress "Building rust_scorer..."
    fi
    if native_core_backprop_wanted; then
      if [ -d ../NEAT-AI-core ]; then
        progress "Building native neat-core library..."
      else
        progress "Verifying native neat-core library..."
      fi
    fi
    if native_train_dir_wanted; then
      if [ -d ../NEAT-AI-Backpropagation ]; then
        progress "Building native neat_ai_backpropagation..."
      else
        progress "Verifying native neat_ai_backpropagation..."
      fi
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
  fi
  echo ""
  echo "Total: $TOTAL steps"
  exit 0
fi

if rust_scorer_wanted; then
  if ! rust_scorer_can_be_resolved; then
    fail_missing_rust_scorer
  fi
fi
if native_core_backprop_wanted; then
  if ! native_core_backprop_can_be_resolved; then
    fail_missing_native_core_backprop
  fi
fi
if native_train_dir_wanted; then
  if ! native_train_dir_can_be_resolved; then
    fail_missing_native_train_dir
  fi
fi

dump_in_flight_tests() {
  local dir="$1"
  local status="$2"
  if [ ! -d "$dir" ]; then
    echo "No in-flight test directory ($dir) after deno test exit $status."
    return 0
  fi
  local found=false
  local f
  for f in "$dir"/*.txt; do
    [ -f "$f" ] || continue
    if [ "$found" = false ]; then
      echo "Tests still running when deno test stopped (exit $status):"
      found=true
    fi
    printf '  %s\n' "$(cat "$f")"
  done
  if [ "$found" = false ]; then
    echo "No in-flight test names left in $dir after deno test exit $status."
  fi
}

run_test_suite() {
  local scorer_mode="$1"
  local IN_FLIGHT_DIR="${NEAT_AI_IN_FLIGHT_DIR:-.quality-in-flight}"
  local -a env_args=(
    "DENO_JOBS=${TEST_JOBS}"
    "NEAT_AI_DISCOVERY_DETERMINISTIC=1"
    "NEAT_AI_IN_FLIGHT_DIR=${IN_FLIGHT_DIR}"
  )

  if [ "$scorer_mode" = "rust" ]; then
    # rust_scorer defaults to --gpu auto. Directory/batch scoring then
    # creates a Metal/wgpu context. Four parallel evolve tests times that
    # context OOMs the host (jetsam SIGKILL / exit 137). The handwritten
    # suite still exercises the native CPU scorer; GPU is a production
    # throughput path, not a correctness path.
    env_args+=(
      "NEAT_AI_RUST_SCORER_ENABLED=1"
      "NEAT_AI_RUST_SCORER_BINARY_PATH=$RUST_SCORER_BINARY_PATH"
      "NEAT_AI_RUST_SCORER_TIMEOUT_MS=$RUST_SCORER_TIMEOUT_MS"
      "NEAT_SCORER_GPU=off"
    )
  else
    env_args+=("NEAT_AI_RUST_SCORER_ENABLED=0")
  fi

  if [ "$NEXT" = true ]; then
    env_args+=("NEAT_AI_NATIVE_CORE_BACKPROP=1")
  else
    # Force off so a leftover operator export cannot enable native backprop
    # on --wasm-scorer / default runs (the packed loop plus --trace-leaks
    # jetsams this suite).
    env_args+=("NEAT_AI_NATIVE_CORE_BACKPROP=0")
    env_args+=("NEAT_AI_BACKPROP_ENABLED=0")
  fi

  echo "V8 heap ${TEST_HEAP_MB} MB × DENO_JOBS=${TEST_JOBS}"
  echo "In-flight test names: ${IN_FLIGHT_DIR}"
  rm -rf "${IN_FLIGHT_DIR}"
  mkdir -p "${IN_FLIGHT_DIR}"
  local status=0
  env "${env_args[@]}" deno test \
    --allow-read \
    --allow-write \
    --allow-net \
    --allow-env \
    --allow-run \
    --trace-leaks \
    --allow-ffi \
    --v8-flags=--max-old-space-size=${TEST_HEAP_MB} \
    --parallel \
    --preload test/_preload.ts \
    --config ./deno.json || status=$?
  if [ "$status" -ne 0 ]; then
    dump_in_flight_tests "${IN_FLIGHT_DIR}" "$status"
    return "$status"
  fi
  rm -rf "${IN_FLIGHT_DIR}"
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

if rust_scorer_wanted; then
  if [ "$RUST_SCORER_BINARY_EXPLICIT" != true ] && [ -d ../NEAT-AI-scorer ]; then
    progress "Building rust_scorer..."
    (cd ../NEAT-AI-scorer && cargo build --release -p rust_scorer)
  fi

  resolved=""
  if [ "$RUST_SCORER_BINARY_EXPLICIT" = true ]; then
    if [ -x "$RUST_SCORER_BINARY_PATH" ]; then
      resolved="$(cd "$(dirname "$RUST_SCORER_BINARY_PATH")" && printf '%s/%s\n' "$(pwd)" "$(basename "$RUST_SCORER_BINARY_PATH")")"
    fi
  elif [ -x ../NEAT-AI-scorer/target/release/rust_scorer ]; then
    resolved="$(cd ../NEAT-AI-scorer/target/release && pwd)/rust_scorer"
  elif command -v "$RUST_SCORER_BINARY_PATH" >/dev/null 2>&1; then
    resolved="$(command -v "$RUST_SCORER_BINARY_PATH")"
  elif [ -x "${HOME}/.cargo/bin/rust_scorer" ]; then
    resolved="${HOME}/.cargo/bin/rust_scorer"
  fi

  if [ -z "$resolved" ] || [ ! -x "$resolved" ]; then
    fail_missing_rust_scorer
  fi

  set +e
  "$resolved" --help >/dev/null 2>&1
  help_rc=$?
  set -e
  if [ "$help_rc" -eq 127 ] || [ "$help_rc" -gt 2 ]; then
    echo "❌ rust_scorer at $resolved could not be executed (exit $help_rc)." >&2
    fail_missing_rust_scorer
  fi

  RUST_SCORER_BINARY_PATH="$resolved"
  echo "✅ rust_scorer ready at $resolved"
fi

if native_core_backprop_wanted; then
  if [ -d ../NEAT-AI-core ]; then
    progress "Building native neat-core library..."
    (cd ../NEAT-AI-core && cargo build --release -p neat-core)
  elif ! native_core_backprop_can_be_resolved; then
    fail_missing_native_core_backprop
  else
    progress "Verifying native neat-core library..."
  fi

  native_check_exit=0
  deno run \
    --allow-read \
    --allow-env \
    --allow-ffi \
    --config ./deno.json \
    scripts/check_native_backprop.ts || native_check_exit=$?
  if [ "$native_check_exit" -ne 0 ]; then
    fail_missing_native_core_backprop
  fi
fi

if native_train_dir_wanted; then
  if [ -d ../NEAT-AI-Backpropagation ]; then
    progress "Building native neat_ai_backpropagation..."
    (cd ../NEAT-AI-Backpropagation && cargo build --release -p neat_ai_backpropagation)
  elif ! native_train_dir_can_be_resolved; then
    fail_missing_native_train_dir
  else
    progress "Verifying native neat_ai_backpropagation..."
  fi

  train_name="$(native_train_dir_file_name)"
  train_bin=""
  if [ -n "${NEAT_AI_BACKPROP_BINARY_PATH:-}" ]; then
    if [ -f "${NEAT_AI_BACKPROP_BINARY_PATH}" ]; then
      train_bin="${NEAT_AI_BACKPROP_BINARY_PATH}"
    elif [ -f "${NEAT_AI_BACKPROP_BINARY_PATH}/${train_name}" ]; then
      train_bin="${NEAT_AI_BACKPROP_BINARY_PATH}/${train_name}"
    fi
  fi
  if [ -z "$train_bin" ] && [ -f "./target/release/${train_name}" ]; then
    train_bin="./target/release/${train_name}"
  fi
  if [ -z "$train_bin" ] && [ -f "../NEAT-AI-Backpropagation/target/release/${train_name}" ]; then
    train_bin="../NEAT-AI-Backpropagation/target/release/${train_name}"
  fi
  if [ -z "$train_bin" ] || [ ! -f "$train_bin" ]; then
    fail_missing_native_train_dir
  fi
  echo "✅ neat_ai_backpropagation ready at $train_bin"
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
