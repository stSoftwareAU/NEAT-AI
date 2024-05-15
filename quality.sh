#!/bin/bash
set -e
export DENO_FUTURE=1
deno fmt src test bench mod.ts
deno lint --fix src test bench mod.ts
rm -rf .trace .test .coverage
deno check `find src -name "*.ts"`
deno test \
  --allow-read \
  --allow-write \
  --trace-leaks \
  --v8-flags=--max-old-space-size=8192 \
  --parallel \
  --config ./test/deno.json \
  --coverage=.coverage \
  --doc