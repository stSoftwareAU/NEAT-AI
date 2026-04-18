# External NEAT-AI-core Dependency

Issue #2343 — this document explains how NEAT-AI consumes shared native Rust
from the [NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core) repository
and how contributors work with it locally.

## Architecture

```
NEAT-AI (this repo)
├── Cargo.toml          ← workspace root; pins neat-core rev
├── wasm_activation/    ← in-tree WASM crate (stays here)
│   └── Cargo.toml      ← depends on neat-core via workspace
└── (future members)    ← e.g. rust_scorer; share the same core pin
```

`neat-core` is the shared computation library extracted from `wasm_activation`.
It lives in the NEAT-AI-core repository and is consumed here as a **git
dependency pinned to a specific commit**.

`wasm_activation` remains in this repository because it owns the WASM
entry-point (`#[wasm_bindgen]` exports) and build tooling (`build.sh`,
`wasm-pack`).

## Bumping the Core Version

1. Identify the target commit or tag in NEAT-AI-core.
2. Update `rev` in the root `Cargo.toml`:

   ```toml
   [workspace.dependencies]
   neat-core = { git = "https://github.com/stSoftwareAU/NEAT-AI-core.git", rev = "<new-sha>" }
   ```

3. Run `cargo update -p neat-core` to refresh `Cargo.lock`.
4. Run `cargo test` to verify parity.

## Local Override for Development

When iterating on `neat-core` locally (e.g. testing a change before pushing to
NEAT-AI-core), add a **path override** in `.cargo/config.toml` at the repository
root:

```toml
# .cargo/config.toml  (DO NOT commit — listed in .gitignore)
[patch."https://github.com/stSoftwareAU/NEAT-AI-core.git"]
neat-core = { path = "../NEAT-AI-core/neat-core" }
```

This tells Cargo to use your local clone instead of the pinned git revision.
Remove the override before committing.

> **Tip:** add `.cargo/config.toml` to your global gitignore or the repo
> `.gitignore` so it is never accidentally committed.

## CI Authentication

For private or token-gated access to NEAT-AI-core on CI, set
`CARGO_NET_GIT_FETCH_WITH_CLI=true` so Cargo uses the system `git` binary (which
inherits the `GITHUB_TOKEN` credential from `actions/checkout`).

See `scripts/rust-ci-git-auth.sh` (when available) for the helper that
configures this automatically.

## Cache Key Invalidation

The CI cache-key script (`scripts/rust-ci-cache-key.sh`, when available) hashes
git coordinates (`git =`, `rev =`, `tag =`, `branch =`) from the workspace
`Cargo.toml` so that a `rev` bump in `neat-core` automatically invalidates the
Cargo cache.
