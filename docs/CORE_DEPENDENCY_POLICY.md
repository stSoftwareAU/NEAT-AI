# NEAT-AI-core Release and Pinning Policy

Issue #2342 — ADR for how NEAT-AI consumes native computation from
[NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core) after removing all
in-repo Rust source.

## Decision Summary

NEAT-AI tracks NEAT-AI-core in `deno.json`:

```json
"neatCore": {
  "repo": "stSoftwareAU/NEAT-AI-core",
  "ref": "Develop"
}
```

`build.sh` is the single integration point. It resolves latest commit for
`repo@ref`, downloads that archive, extracts `wasm_activation/pkg`, and writes
`wasm_activation/pkg/neat_core_rev.txt`.

## Why This Model

- Release control happens at PR approval and merge timing.
- No Rust toolchain required in NEAT-AI CI or local contributor setup.
- External API stays unchanged (`wasm_activation/pkg/**` is still published).

## Bumping NEAT-AI-core

1. Keep `deno.json` `neatCore.ref` set to the desired tracked branch (typically
   `Develop`).
2. Run `./build.sh` to refresh `wasm_activation/pkg` from latest core commit.
3. Run `./scripts/parity-gate.sh` and `./quality.sh`.
4. Commit updated `wasm_activation/pkg/**` in the PR.

## CI Policy

- CI must run `./build.sh` before quality/test/publish.
- `wasm_activation/pkg` may change whenever NEAT-AI-core `ref` advances.
- No Cargo, `rustc`, or `wasm-pack` steps run in this repo.

## Semver and Approvals

NEAT-AI-core tags continue to follow `v<MAJOR>.<MINOR>.<PATCH>`.

- Patch bumps: any contributor after CI passes.
- Minor bumps: one approving review.
- Major bumps: owner approval.

## Downstream Alignment (NEAT-AI-scorer)

Downstream consumers should align to the same NEAT-AI-core branch/ref policy
used by this repo’s `deno.json`.

## Related Documents

- [docs/EXTERNAL_NEAT_AI_CORE.md](EXTERNAL_NEAT_AI_CORE.md)
- [docs/CI_EXTERNAL_NEAT_AI_CORE.md](CI_EXTERNAL_NEAT_AI_CORE.md)
- [docs/PARITY_GATE.md](PARITY_GATE.md)
