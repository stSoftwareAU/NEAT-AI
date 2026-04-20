# WASM Activation Parity Audit (Issue #2369)

This document is retained as historical context.

## Current state

- `wasm_activation/src/` Rust sources have been removed from this repository.
- The runtime contract remains unchanged for callers: `wasm_activation/pkg/**`
  is still shipped and loaded by TypeScript.
- `deno.json` `neatCore.rev` is the single source of truth for core revision.
- `./build.sh` refreshes `wasm_activation/pkg` from that pinned NEAT-AI-core
  commit.

## Ongoing parity checks

Use:

```bash
./scripts/parity-gate.sh
```

This validates pin policy, artifact sync, and TypeScript/WASM parity tests.
