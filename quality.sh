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
  scripts/check_discovery.ts; then
  echo "❌ Discovery checks failed"
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
