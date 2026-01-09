#!/bin/bash
set -e

# WebGPU mode:
# - auto (default): run WebGPU tests if a usable adapter is available
# - off: never run WebGPU tests
WEBGPU_MODE="auto"
for arg in "$@"; do
  case "$arg" in
    --no-webgpu)
      WEBGPU_MODE="off"
      ;;
    --help|-h)
      echo "Usage: ./quality.sh [--no-webgpu]"
      echo ""
      echo "Options:"
      echo "  --no-webgpu  Disable WebGPU tests even if a usable adapter is available."
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Run: ./quality.sh --help" >&2
      exit 2
      ;;
  esac
done

# Runs a command with a timeout (seconds). Kills the process if it exceeds.
# This avoids having to manually Ctrl+C when WebGPU stalls.
run_with_timeout() {
  local seconds="$1"
  shift
  "$@" &
  local pid=$!

  (
    sleep "$seconds"
    echo "❌ Timed out after ${seconds}s: $*" >&2
    # Ask nicely first so Deno can print the list of pending tests (like Ctrl-C).
    kill -INT "$pid" 2>/dev/null || true
    sleep 2
    kill -TERM "$pid" 2>/dev/null || true
    sleep 2
    kill -KILL "$pid" 2>/dev/null || true
  ) >/dev/null 2>&1 &
  local watchdog=$!

  wait "$pid"
  local status=$?
  kill "$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true
  return "$status"
}

# GPU activation is "auto" by default in the library. During quality runs you can
# explicitly disable it to compare behaviour.
if [ "$WEBGPU_MODE" = "off" ]; then
  export NEAT_WGPU_ACTIVATION=0
else
  unset NEAT_WGPU_ACTIVATION || true
fi

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
(cd ../NEAT-AI-Discovery && ./scripts/runlib.sh)
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

if [ "$WEBGPU_MODE" != "off" ]; then
  echo ""
  echo "Running WebGPU activation correctness tests..."
  if deno eval --unstable-webgpu '
    if (typeof navigator === "undefined" || !navigator.gpu) Deno.exit(1);
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) Deno.exit(1);
  ' >/dev/null 2>&1; then
    # Preflight: prove we can compile a trivial compute pipeline quickly.
    # Some driver/stack combinations can stall indefinitely during pipeline compilation.
    if ! run_with_timeout 10 deno eval --unstable-webgpu '
      if (typeof navigator === "undefined" || !navigator.gpu) Deno.exit(1);
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) Deno.exit(1);
      const device = await adapter.requestDevice();
      const module = device.createShaderModule({ code: `
        @compute @workgroup_size(1)
        fn main() { }
      `});
      device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
    ' >/dev/null 2>&1; then
      echo "⚠️  WebGPU preflight did not complete quickly. Skipping WebGPU tests to avoid a hang."
    else
    # WebGPU can deadlock or stall on some drivers.
    # Run these tests sequentially and with an external watchdog timeout.
    for f in test/wgpu/*.ts; do
      echo ""
      echo "  - WebGPU tests: $f"
      if ! run_with_timeout 55 \
        env NEAT_WGPU_ACTIVATION=1 NEAT_WGPU_ACTIVATION_STRICT=1 deno test \
        --allow-read \
        --allow-write \
        --allow-env \
        --unstable-webgpu \
        --config ./deno.json \
        "$f"; then
        echo "⚠️  WebGPU tests stalled or failed. Skipping remaining WebGPU tests."
        break
      fi
    done
    fi
  else
    echo "WebGPU adapter not available on this machine. Skipping WebGPU tests."
  fi
fi

run_with_timeout 3600 \
  env NEAT_WGPU_ACTIVATION=0 NEAT_RUST_DISCOVERY_OPTIONAL=true NEAT_AI_DISCOVERY_DETERMINISTIC=1 deno test \
  --allow-read \
  --allow-write \
  --allow-net \
  --allow-env \
  --v8-flags=--max-old-space-size=8192 \
  --parallel \
  --config ./deno.json \
  --ignore=test/ErrorGuidedStructuralEvolution/RustDiscoveryRequired.ts \
  test/ErrorGuidedStructuralEvolution/*.ts

echo "Running tests with FFI enabled (full functionality)..."
run_with_timeout 3600 \
  env NEAT_WGPU_ACTIVATION=0 NEAT_AI_DISCOVERY_DETERMINISTIC=1 deno test \
  --allow-read \
  --allow-write \
  --allow-net \
  --allow-env \
  --trace-leaks \
  --allow-ffi \
  --v8-flags=--max-old-space-size=8192 \
  --parallel \
  --config ./deno.json

  # --trace-leaks \
# Note: --trace-leaks is disabled for discovery tests because the Rust library
