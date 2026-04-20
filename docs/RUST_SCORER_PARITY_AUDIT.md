# rust_scorer Parity Audit (Issue #2368)

Historical note:

- The previous in-repo Rust scorer experiment is no longer part of this
  repository structure.
- Core native logic now lives in NEAT-AI-core and is consumed through pinned
  artifact sync (`deno.json` + `./build.sh`).

For current validation, rely on:

- `./scripts/parity-gate.sh`
- `./quality.sh`
