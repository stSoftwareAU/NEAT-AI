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

deno test \
  --allow-read \
  --allow-write \
  --allow-net \
  --trace-leaks \
  --v8-flags=--max-old-space-size=8192 \
  --parallel \
  --config ./deno.json
