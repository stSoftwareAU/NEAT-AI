#!/bin/bash
set -e
deno outdated --update --latest
deno fmt src test bench mod.ts docs
deno lint --fix src test bench mod.ts
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
