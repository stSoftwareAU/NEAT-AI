# NEAT-AI-core Parity Audit (Issue #2367)

Historical summary:

- Earlier audits compared in-repo Rust sources with NEAT-AI-core.
- This repository now carries no Rust source; parity is enforced through:
  - `deno.json` `neatCore.rev` pinning
  - `./build.sh` artifact sync into `wasm_activation/pkg`
  - `./scripts/parity-gate.sh` regression checks

Use the parity gate output as the authoritative evidence for current releases.
