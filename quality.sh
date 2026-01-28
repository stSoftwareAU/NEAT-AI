#!/bin/bash
set -e

# Optional WASM toggles:
# - --no-wasm: run full suite with WASM disabled by default (baseline JS run)
# - --wasm: run full suite with WASM enabled by default (where supported)
# - --wasm-fast: run full suite with WASM enabled, but only for larger networks (much faster)
# - --wasm-only / --compare-wasm: run only WASM activation tests (these compare JS vs WASM outputs)
# - --skip-wasm-tests: skip WASM activation tests entirely
# - --wasm-build: rebuild wasm_activation/pkg before running WASM tests
MODE="all"
WASM_BUILD="false"

usage() {
  cat <<'EOF'
Usage: ./quality.sh [options]

Options:
  --no-wasm         Run full quality suite with WASM disabled by default
  --wasm            Run full quality suite with WASM enabled by default (guarded to avoid slowdowns)
  --wasm-fast       Run full quality suite with WASM enabled only for larger networks
  --wasm-only       Run only WASM activation tests (JS vs WASM comparisons)
  --compare-wasm    Alias for --wasm-only
  --skip-wasm-tests Skip WASM activation tests entirely
  --wasm-build      Rebuild wasm_activation/pkg before WASM tests
  -h, --help        Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-wasm)
      MODE="no-wasm"
      shift
      ;;
    --wasm)
      MODE="wasm"
      shift
      ;;
    --wasm-fast)
      MODE="wasm-fast"
      shift
      ;;
    --wasm-only|--compare-wasm)
      MODE="wasm-only"
      shift
      ;;
    --skip-wasm-tests)
      MODE="skip-wasm-tests"
      shift
      ;;
    --wasm-build)
      WASM_BUILD="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# Ensure deno is in PATH (common install locations)
export PATH="$HOME/.deno/bin:$PATH"

deno outdated --update --latest
deno fmt src test bench mod.ts docs
deno lint --fix src test bench mod.ts

echo "Checking bash script syntax..."
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

rm -rf .trace .test .coverage
deno check

WASM_TEST_IGNORE_ARGS=(--ignore=test/WasmActivation.ts --ignore=test/CreatureWasmActivation.ts)
WASM_TEST_FILES=(test/WasmActivation.ts test/CreatureWasmActivation.ts)

if [[ "$MODE" == "wasm-only" ]]; then
  if [[ "$WASM_BUILD" == "true" ]]; then
    echo "Rebuilding WASM module (wasm_activation/pkg)..."
    chmod +x wasm_activation/build.sh
    ./wasm_activation/build.sh
  fi

  echo ""
  echo "Running WASM activation tests (JS vs WASM comparisons)..."
  NEAT_AI_DISCOVERY_DETERMINISTIC=1 deno test \
    --allow-read \
    --allow-write \
    --allow-net \
    --allow-env \
    --v8-flags=--max-old-space-size=8192 \
    --parallel \
    --config ./deno.json \
    "${WASM_TEST_FILES[@]}"
  exit 0
fi

if [[ ( "$MODE" == "wasm" || "$MODE" == "wasm-fast" ) ]] && [[ "$WASM_BUILD" == "true" ]]; then
  echo "Rebuilding WASM module (wasm_activation/pkg)..."
  chmod +x wasm_activation/build.sh
  ./wasm_activation/build.sh
fi

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
    echo "   - Bug in library initialization"
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

echo ""
echo "Running discovery tests without FFI to verify graceful degradation..."

NO_WASM_ARGS=()
if [[ "$MODE" == "skip-wasm-tests" ]]; then
  NO_WASM_ARGS=("${WASM_TEST_IGNORE_ARGS[@]}")
fi

ENV_CMD=(env)
if [[ "$MODE" == "wasm" ]]; then
  # Enable WASM by default.
  #
  # Important: using WASM requires per-creature compilation. For small networks
  # (especially in evolutionary loops that create many tiny creatures), forcing
  # WASM everywhere can make the suite appear "stuck" for a very long time.
  #
  # So for the full suite we keep WASM on, but apply conservative size
  # thresholds to avoid pathological slowdowns. Dedicated WASM comparison tests
  # are still covered by `--wasm-only`.
  ENV_CMD+=(NEAT_AI_USE_WASM=1 NEAT_AI_WASM_AUTO_INIT=1 NEAT_AI_USE_WASM_MIN_NEURONS=32 NEAT_AI_USE_WASM_MIN_SYNAPSES=128)
elif [[ "$MODE" == "wasm-fast" ]]; then
  # Prefer WASM only where it is likely beneficial, to keep the suite quick.
  ENV_CMD+=(NEAT_AI_USE_WASM=1 NEAT_AI_WASM_AUTO_INIT=1 NEAT_AI_USE_WASM_MIN_NEURONS=64 NEAT_AI_USE_WASM_MIN_SYNAPSES=256)
elif [[ "$MODE" == "no-wasm" ]]; then
  # Force baseline JS default even if the user's shell has WASM env vars set.
  ENV_CMD+=(NEAT_AI_USE_WASM=0 NEAT_AI_WASM_AUTO_INIT=0)
fi

"${ENV_CMD[@]}" NEAT_RUST_DISCOVERY_OPTIONAL=true NEAT_AI_DISCOVERY_DETERMINISTIC=1 deno test \
  --allow-read \
  --allow-write \
  --allow-net \
  --allow-env \
  --v8-flags=--max-old-space-size=8192 \
  --parallel \
  --config ./deno.json \
  "${NO_WASM_ARGS[@]}" \
  --ignore=test/ErrorGuidedStructuralEvolution/RustDiscoveryRequired.ts \
  test/ErrorGuidedStructuralEvolution/*.ts

echo "Running tests with FFI enabled (full functionality)..."
"${ENV_CMD[@]}" NEAT_AI_DISCOVERY_DETERMINISTIC=1 deno test \
  --allow-read \
  --allow-write \
  --allow-net \
  --allow-env \
  --trace-leaks \
  --allow-ffi \
  --v8-flags=--max-old-space-size=8192 \
  --parallel \
  --config ./deno.json \
  "${NO_WASM_ARGS[@]}"

  # --trace-leaks \
# Note: --trace-leaks is disabled for discovery tests because the Rust library
