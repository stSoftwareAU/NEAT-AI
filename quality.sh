#!/bin/bash
set -e

# Ensure deno is in PATH (common install locations)
export PATH="$HOME/.deno/bin:$PATH"

# --- Flag parsing ---
SKIP_TESTS=false
SKIP_DISCOVERY=false
LINT_ONLY=false
CHECK_ONLY=false
DRY_RUN=false

show_help() {
  cat <<'HELP'
Usage: ./quality.sh [OPTIONS]

Pre-commit quality gate that runs formatting, linting, type-checking,
discovery build, and all tests.

Options:
  --help, -h          Show this help message and exit
  --skip-tests        Skip test execution
  --skip-discovery    Skip discovery library build and verification
  --lint-only         Only run formatting + linting (includes bash check)
  --check-only        Only run type-checking (deno check)
  --dry-run           Show which steps would run without executing them

Steps (default, all enabled):
  [1/7] Updating dependencies
  [2/7] Formatting code
  [3/7] Linting
  [4/7] Checking bash scripts
  [5/7] Type-checking
  [6/7] Building discovery library
  [7/7] Running tests

Exit codes:
  0   All steps passed
  1   A step failed or an unknown option was provided

Examples:
  ./quality.sh                          # Run all steps
  ./quality.sh --skip-tests             # Quick check without tests
  ./quality.sh --skip-discovery         # Skip discovery build/verify
  ./quality.sh --lint-only              # Format + lint only
  ./quality.sh --check-only             # Type-check only
  ./quality.sh --skip-tests --skip-discovery  # Combine skip flags
HELP
}

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      show_help
      exit 0
      ;;
    --skip-tests)
      SKIP_TESTS=true
      ;;
    --skip-discovery)
      SKIP_DISCOVERY=true
      ;;
    --lint-only)
      LINT_ONLY=true
      ;;
    --check-only)
      CHECK_ONLY=true
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Run './quality.sh --help' for usage information." >&2
      exit 1
      ;;
  esac
done

# --- Determine which steps to run ---
RUN_DEPS=true
RUN_FMT=true
RUN_LINT=true
RUN_BASH_CHECK=true
RUN_TYPE_CHECK=true
RUN_DISCOVERY=true
RUN_TESTS=true

if [ "$LINT_ONLY" = true ]; then
  RUN_DEPS=true
  RUN_FMT=true
  RUN_LINT=true
  RUN_BASH_CHECK=true
  RUN_TYPE_CHECK=false
  RUN_DISCOVERY=false
  RUN_TESTS=false
fi

if [ "$CHECK_ONLY" = true ]; then
  RUN_DEPS=false
  RUN_FMT=false
  RUN_LINT=false
  RUN_BASH_CHECK=false
  RUN_TYPE_CHECK=true
  RUN_DISCOVERY=false
  RUN_TESTS=false
fi

if [ "$SKIP_TESTS" = true ]; then
  RUN_TESTS=false
fi

if [ "$SKIP_DISCOVERY" = true ]; then
  RUN_DISCOVERY=false
fi

# --- Count active steps for progress numbering ---
TOTAL=0
[ "$RUN_DEPS" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_FMT" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_LINT" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_BASH_CHECK" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_TYPE_CHECK" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_DISCOVERY" = true ] && TOTAL=$((TOTAL + 1))
[ "$RUN_TESTS" = true ] && TOTAL=$((TOTAL + 1))

STEP=0

progress() {
  STEP=$((STEP + 1))
  echo ""
  echo "[$STEP/$TOTAL] $1"
}

# --- Dry run mode ---
if [ "$DRY_RUN" = true ]; then
  echo "DRY RUN — the following steps would be executed:"
  echo ""
  [ "$RUN_DEPS" = true ] && progress "Updating dependencies..."
  [ "$RUN_FMT" = true ] && progress "Formatting code..."
  [ "$RUN_LINT" = true ] && progress "Linting..."
  [ "$RUN_BASH_CHECK" = true ] && progress "Checking bash scripts..."
  [ "$RUN_TYPE_CHECK" = true ] && progress "Type-checking..."
  [ "$RUN_DISCOVERY" = true ] && progress "Building discovery library..."
  [ "$RUN_TESTS" = true ] && progress "Running tests..."
  echo ""
  echo "Total: $TOTAL steps"
  exit 0
fi

# --- Execute steps ---

if [ "$RUN_DEPS" = true ]; then
  progress "Updating dependencies..."
  deno outdated --update --latest
fi

if [ "$RUN_FMT" = true ]; then
  progress "Formatting code..."
  deno fmt src test bench mod.ts docs
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
  done < <(find . -name "*.sh" -type f)

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
  # # is intentionally loaded and kept in memory for performance (not a leak)

  echo "Verifying discovery library availability..."
  if ! deno run \
    --allow-read \
    --allow-env \
    --allow-ffi \
    --config ./deno.json \
    scripts/check_discovery_safe.ts 2>&1; then
    exit_code=$?
    if [ $exit_code -eq 137 ] || [ $exit_code -eq 9 ]; then
      echo ""
      echo "❌ Discovery library crashed on load (Killed: 9 or exit code 137)"
      echo "   This indicates a fatal crash (segmentation fault) in the Rust library."
      echo "   Common causes:"
      echo "   - Architecture mismatch (x86_64 vs arm64)"
      echo "   - Missing dependencies"
      echo "   - Library built for different macOS version"
      echo "   - Bug in library initialisation"
      echo ""
      echo "   Diagnostic steps:"
      echo "   1. Check library architecture:"
      echo "      file ~/.cargo/lib/libneat_ai_discovery.dylib"
      echo "   2. Check dependencies:"
      echo "      otool -L ~/.cargo/lib/libneat_ai_discovery.dylib"
      echo "   3. Rebuild the library:"
      echo "      cd ../NEAT-AI-Discovery && ./scripts/runlib.sh"
    else
      echo "❌ Discovery checks failed (exit code: $exit_code)"
    fi
    exit 1
  fi
fi

if [ "$RUN_TESTS" = true ]; then
  progress "Running tests..."
  NEAT_AI_DISCOVERY_DETERMINISTIC=1 deno test \
    --allow-read \
    --allow-write \
    --allow-net \
    --allow-env \
    --allow-run \
    --trace-leaks \
    --allow-ffi \
    --v8-flags=--max-old-space-size=8192 \
    --parallel \
    --config ./deno.json
fi
