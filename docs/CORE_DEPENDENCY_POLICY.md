# NEAT-AI-core Release and Pinning Policy

Issue #2342 — Architecture Decision Record (ADR) for how NEAT-AI consumes the
shared Rust library from
[NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core).

## Decision Summary

NEAT-AI pins `neat-core` as a **git dependency with an explicit `rev`** (full
40-character SHA). This gives reproducible builds, instant availability on push,
and no external registry dependency. crates.io publication is **not required**
at this stage but remains an option for the future.

## Crate Name

| Repository          | Crate name                         | Cargo dependency key               |
| ------------------- | ---------------------------------- | ---------------------------------- |
| NEAT-AI-core        | `neat-core`                        | `neat-core`                        |
| NEAT-AI (this repo) | `wasm_activation` (in-tree member) | inherits `neat-core` via workspace |

The crate is named `neat-core` (hyphenated). Do **not** use `neat_ai_core` or
`neat-ai-core` — those refer to the repository, not the crate.

## Workspace Layout

```
NEAT-AI (this repo)
├── Cargo.toml              ← workspace root; single source of truth for the neat-core rev
├── wasm_activation/        ← in-tree WASM crate; uses `neat-core = { workspace = true }`
│   └── Cargo.toml
└── (future workspace members inherit the same pinned rev)
```

Every workspace member that depends on `neat-core` **must** use
`{ workspace = true }` so the rev is controlled in exactly one place.

## Pinning Model

### Default: git + rev

```toml
# Root Cargo.toml — the only place the rev is declared
[workspace.dependencies]
neat-core = { git = "https://github.com/stSoftwareAU/NEAT-AI-core.git", rev = "<full-40-char-sha>" }
```

**Why rev, not tag or branch?**

- A `rev` is **immutable** — the build is identical regardless of when or where
  it runs.
- A `branch` tracks a moving target and can silently break consumers.
- A `tag` is safer than a branch but can be force-pushed. A rev cannot.

Tags are used in NEAT-AI-core for human reference (see semver policy below) but
the consumer always pins the underlying commit SHA.

### Local Development Override

When iterating on `neat-core` locally, add a **path override** in
`.cargo/config.toml` at the repository root:

```toml
# .cargo/config.toml  (DO NOT commit — listed in .gitignore)
[patch."https://github.com/stSoftwareAU/NEAT-AI-core.git"]
neat-core = { path = "../NEAT-AI-core/neat-core" }
```

Remove the override before committing. The file is git-ignored by the `.*` rule.

### CI Authentication

Set `CARGO_NET_GIT_FETCH_WITH_CLI=true` so Cargo uses the system `git` binary
and inherits the `GITHUB_TOKEN` credential injected by `actions/checkout`. See
`scripts/rust-ci-git-auth.sh` for the helper and
[docs/CI_EXTERNAL_NEAT_AI_CORE.md](CI_EXTERNAL_NEAT_AI_CORE.md) for full CI
details.

## Semver and Tagging Policy

NEAT-AI-core follows [Semantic Versioning 2.0.0](https://semver.org/):

| Change type                      | Version bump      | Examples                            |
| -------------------------------- | ----------------- | ----------------------------------- |
| Bug fix, docs, internal refactor | **patch** (0.1.x) | Fix rounding, update comments       |
| New public API, new feature      | **minor** (0.x.0) | Add new activation helper           |
| Breaking API change              | **major** (x.0.0) | Rename public function, remove type |

### Tag Format

Tags on NEAT-AI-core use the format `v<MAJOR>.<MINOR>.<PATCH>`, e.g. `v0.1.1`.
Every tagged release must have a corresponding commit on the `Develop` branch.

### When to Bump the Core Dependency in NEAT-AI

1. **Identify the need** — a NEAT-AI PR requires a new feature or fix from
   `neat-core`.
2. **Verify the target** — the required commit must be merged to `Develop` in
   NEAT-AI-core and (for non-trivial changes) tagged with a semver release.
3. **Update the rev** — change the `rev` in the root `Cargo.toml` to the new
   full SHA.
4. **Refresh the lock** — run `cargo update -p neat-core`.
5. **Run tests** — `cargo test` in the workspace root and the full
   `./quality.sh` gate.
6. **Commit** — include the tag (if any) in the commit message, e.g.
   `bump neat-core to v0.2.0 (abc1234...)`.

### Approval Requirements

- **Patch bumps** (bug fixes): any contributor may bump after CI passes.
- **Minor bumps** (new features): require at least one approving review on the
  NEAT-AI PR.
- **Major bumps** (breaking changes): require repository-owner approval and must
  be coordinated so all workspace members are updated atomically.

The `Develop` branch on NEAT-AI-core is protected; all changes reach it via pull
request.

## Downstream Consumer Alignment (Scorer)

Issue #2348 — any downstream consumer of `neat-core` that shares types or
behaviour with NEAT-AI **must** pin the **same `rev`** as the NEAT-AI workspace
root `Cargo.toml`. This prevents version skew where two repositories compile
against different snapshots of the shared crate.

### NEAT-AI-scorer

[NEAT-AI-scorer](https://github.com/stSoftwareAU/NEAT-AI-scorer) (or any future
equivalent scorer tooling) is the primary downstream consumer. Its workspace
`Cargo.toml` must:

1. Use `neat-core` as the dependency name (not `neat_ai_core` or
   `neat-ai-core`).
2. Pin via `git` + `rev` to the **same 40-character SHA** used in NEAT-AI.
3. Use `{ workspace = true }` for all workspace members that depend on
   `neat-core`.

### Verification checklist

When bumping `neat-core` in NEAT-AI, also:

1. **Check** the scorer workspace `Cargo.toml` — confirm the `rev` matches.
2. **Update** the scorer `rev` in the same coordinated change if it has drifted.
3. **Run** `cargo test` in the scorer workspace to verify parity.

Bench scripts (e.g. `BENCH_RUST_SCORER`) and any tooling that references the
crate layout must be updated to reflect the current workspace structure when new
members are added or the scorer crate is restructured.

## Future: crates.io Publication

If `neat-core` is published to [crates.io](https://crates.io/) in the future:

1. Replace the `git` dependency with a version requirement:
   ```toml
   neat-core = "0.2"
   ```
2. Update this policy to reflect the new pinning model.
3. Continue tagging releases on GitHub for traceability.

Until then, git + rev pinning is the default and sole supported model.

## Related Documents

- [docs/EXTERNAL_NEAT_AI_CORE.md](EXTERNAL_NEAT_AI_CORE.md) — architecture and
  day-to-day workflow for bumping the core dependency.
- [docs/CI_EXTERNAL_NEAT_AI_CORE.md](CI_EXTERNAL_NEAT_AI_CORE.md) — CI plumbing
  for auth, caching, and WASM builds.
