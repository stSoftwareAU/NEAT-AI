#!/bin/bash
set -e

deno fmt src test
deno lint src test
find test -name "*.ts" -print0 | xargs -0  deno test --allow-all --trace-ops --v8-flags=--max-old-space-size=8192 --parallel