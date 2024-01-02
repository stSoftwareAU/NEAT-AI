#!/bin/bash
set -e

deno fmt src test
deno lint src test
deno test --allow-all --trace-ops --v8-flags=--max-old-space-size=8192 test/*