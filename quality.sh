#!/bin/bash
set -e
export DENO_FUTURE=1
deno fmt src test bench mod.ts www
deno lint --fix src test bench mod.ts
rm -rf .trace .test .coverage

# Use xargs to handle file list gracefully, with a larger batch size
find src -name "*.ts" -print0 | xargs -0 -n 50 deno check
find test -name "*.ts" -print0 | xargs -0 -n 50 deno check

deno test \
  --allow-read \
  --allow-write \
  --allow-net \
  --trace-leaks \
  --v8-flags=--max-old-space-size=8192 \
  --parallel \
  --coverage=.coverage \
  --config ./deno.json \
  --doc
