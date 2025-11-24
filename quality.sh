#!/bin/bash
set -e
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

NEAT_RUST_DISCOVERY_OPTIONAL=true NEAT_AI_DISCOVERY_DETERMINISTIC=1 deno test \
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
NEAT_AI_DISCOVERY_DETERMINISTIC=1 deno test \
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
