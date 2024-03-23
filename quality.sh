#!/bin/bash
set -e

deno fmt src test bench mod.ts
deno lint src test bench mod.ts
rm -rf .trace .test
deno test \
  --allow-read \
  --allow-write \
  --trace-leaks \
  --v8-flags=--max-old-space-size=8192 \
  --parallel \
  --config ./test/deno.json \
  --coverage=.coverage \
  --doc