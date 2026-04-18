## Summary

Define the NEAT-AI-core release and pinning policy as an Architecture Decision
Record. Confirms crate names, workspace layout, semver tagging conventions, and
approval requirements for bumping the core dependency. Closes #2342.

## Changes

- **docs/CORE_DEPENDENCY_POLICY.md** — full ADR covering:
  - Pinning model: git dependency with `rev` (full 40-char SHA), not branch
  - Crate name: `neat-core` (hyphenated), not `neat_ai_core` or `neat-ai-core`
  - Workspace layout: single `rev` in root `Cargo.toml`, members inherit via
    `{ workspace = true }`
  - Local dev: `.cargo/config.toml` path override (git-ignored)
  - Semver/tag policy: `v<MAJOR>.<MINOR>.<PATCH>` on NEAT-AI-core
  - Approval tiers: patch = CI green, minor = one review, major = owner
  - Future crates.io path documented
- **AGENTS.md** — added summary section and documentation layout entry
- **test/scripts/CoreDependencyPolicy.ts** — 8 policy-enforcement tests

## Evidence

This is a documentation/policy change with no runtime code modifications. The
tests validate that `Cargo.toml` conforms to the documented policy (rev pinning,
correct crate name, workspace inheritance). All 5961 tests pass, including the
8 new policy tests.

## Test Plan

- `test/scripts/CoreDependencyPolicy.ts` — 8 tests:
  - `workspace Cargo.toml pins neat-core via git with a rev`
  - `workspace Cargo.toml rev is a valid 40-char hex SHA`
  - `wasm_activation uses workspace dependency for neat-core`
  - `workspace does not use branch pinning for neat-core`
  - `core dependency policy document exists`
  - `policy document covers required sections`
  - `AGENTS.md references the core dependency policy`
  - `workspace crate name matches policy (neat-core not neat_ai_core)`
