## Summary

Audits every `pub` item and inline `#[test]` in the in-tree `neat-core/`
crate (on branch `milestone/pure-rust-scorer-experiment`) against the
external [NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core)
crate at the rev pinned in `Cargo.toml`
(`36ac4ea34fcd4e89d9fad3d6fae9efc5f02c8959`). Records the parity matrix
in `docs/NEAT_AI_CORE_PARITY_AUDIT.md` and commits a reproducible
auditing script at `scripts/neat-core-parity-audit.sh`.

**Result: zero gaps.** All 136 pub items, 14 top-level `impl` blocks,
and 232 `#[test]` functions in the in-tree `neat-core/src/*.rs` are
present in NEAT-AI-core at the pinned rev (inline in `src/*.rs` or as
integration tests under `neat-core/tests/*.rs`). NEAT-AI-core is also
ahead with an additional `training_bin_stream.rs` module. No upstream
issues need to be raised; the pinned `rev` does not need to be bumped.
This satisfies the precondition on Issue #2346 (remove in-tree native
Rust).

Closes #2367.

## Evidence

Backend/CLI change — no UI to screenshot. The evidence is:

- The reproducible audit script `./scripts/neat-core-parity-audit.sh`,
  which fails non-zero if any pub item or `#[test]` in the in-tree
  `neat-core/src/` has no counterpart in NEAT-AI-core at the pinned
  rev. Current run output is reproduced verbatim in
  `docs/NEAT_AI_CORE_PARITY_AUDIT.md`.
- `./quality.sh` passed locally (6004 tests ok, 0 failed).

Script output (abridged):

```
NEAT-AI-core parity audit @ rev 36ac4ea34fcd4e89d9fad3d6fae9efc5f02c8959
…
Gaps: pub=0 impl=0 tests=0
All in-tree pub items and tests are present in NEAT-AI-core at the pinned rev.
```

## Test Plan

- `./scripts/neat-core-parity-audit.sh` — exits 0 with the matrix printed.
- `./scripts/neat-core-parity-audit.sh --json` — emits raw scan data.
- `./quality.sh` — full gate (lint, fmt, bash check, deno check,
  discovery build, WASM build + Rust tests, Deno test suite) passes.

## Acceptance criteria

- [x] Parity matrix covers all 20 in-tree source files
  (`docs/NEAT_AI_CORE_PARITY_AUDIT.md`).
- [x] Every `pub` item confirmed present in NEAT-AI-core at pinned rev.
- [x] Every `#[test]` confirmed present in NEAT-AI-core (inline or
  integration).
- [x] Missing items: **none** — no upstream issues needed.
- [x] Pinned rev in `Cargo.toml` already covers all audited items;
  no bump required.
- [x] `./quality.sh` passes.
