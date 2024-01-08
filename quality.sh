#!/bin/bash
set -e

deno fmt src test mod.ts
deno lint src test mod.ts
rm -rf .trace
deno test --allow-all --trace-ops --v8-flags=--max-old-space-size=8192 --parallel --config ./test/deno.json