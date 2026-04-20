# External NEAT-AI-core Dependency

Issue #2343 — this document explains how NEAT-AI consumes shared native Rust
from the [NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core) repository
and how contributors work with it locally.

## Architecture

```
NEAT-AI (this repo)
├── deno.json           ← pins neatCore.repo + neatCore.rev
├── build.sh            ← fetches wasm_activation/pkg from pinned NEAT-AI-core rev
└── wasm_activation/pkg ← vendored runtime artifacts consumed by TS loaders
```

`neat-core` implementation lives fully in NEAT-AI-core. This repository consumes
prebuilt WASM artifacts by pinning a commit SHA in `deno.json` and syncing via
`./build.sh`.

## Bumping the Core Version

1. Identify the target commit or tag in NEAT-AI-core.
2. Update `deno.json`:

   ```json
   "neatCore": {
     "repo": "stSoftwareAU/NEAT-AI-core",
     "rev": "<new-40-char-sha>"
   }
   ```

3. Run `./build.sh` to refresh `wasm_activation/pkg`.
4. Run `./scripts/parity-gate.sh` and `./quality.sh`.

## NEAT-AI-scorer Alignment

Issue #2348 — [NEAT-AI-scorer](https://github.com/stSoftwareAU/NEAT-AI-scorer)
(or equivalent scorer tooling) should use the **same NEAT-AI-core revision** as
this repository to avoid version skew. When the two repositories compile against
different snapshots of core logic, shared types and scoring behaviour can
silently diverge.

### How to verify alignment

After bumping `neatCore.rev` here, confirm the scorer is aligned:

```bash
# Extract the rev from NEAT-AI:
deno eval 'const c = JSON.parse(Deno.readTextFileSync("deno.json")); console.log(c.neatCore.rev)'

# Compare against the scorer workspace:
deno eval 'const c = JSON.parse(Deno.readTextFileSync("../NEAT-AI-scorer/deno.json")); console.log(c.neatCore.rev)'
```

If the revisions differ, update the scorer pin and rerun its tests in the same
coordinated bump.

See [docs/CORE_DEPENDENCY_POLICY.md](CORE_DEPENDENCY_POLICY.md) for the full
pinning policy and downstream consumer alignment requirements.

## Sync Invariant

`wasm_activation/pkg/**` should change only in commits that also change
`deno.json` `neatCore.rev`.
