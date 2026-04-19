# NEAT-AI-core Parity Gate

Issue #2345 (part of #2341) — parity checklist that **must pass** before any
in-tree native Rust is removed in favour of the external
[NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core) crate.

The goal is narrow: make sure switching `wasm_activation` from an in-tree
sibling crate to the pinned `neat-core` git dependency does not regress the
scoring, activation, or topology surface that production relies on.

## When to run the gate

- Before opening a PR that **removes** any in-tree native Rust (crates,
  workspace members, or large chunks of code duplicated from `neat-core`).
- After **bumping the `neat-core` rev** in the root `Cargo.toml`.
- As part of any release checklist where the Rust dependency graph changed.

The full `./quality.sh` remains the release-wide quality gate; the parity gate
is a focused pre-removal check.

## Commands

The single entry point is `scripts/parity-gate.sh`. All steps must pass before
sign-off.

```bash
# Run every step (recommended):
./scripts/parity-gate.sh

# Preview the steps without running them:
./scripts/parity-gate.sh --dry-run

# Skip selectively if a toolchain is unavailable:
./scripts/parity-gate.sh --skip-rust   # no cargo / rustc
./scripts/parity-gate.sh --skip-deno   # no deno

# Help:
./scripts/parity-gate.sh --help
```

### Step 1 — Core dependency policy

```bash
deno test --no-check --allow-read \
  --config ./deno.json test/scripts/CoreDependencyPolicy.ts
```

Verifies the invariants from
[docs/CORE_DEPENDENCY_POLICY.md](CORE_DEPENDENCY_POLICY.md):

- Workspace `Cargo.toml` pins `neat-core` with a **git `rev`** (no branch
  pinning).
- The `rev` is a **full 40-character hex SHA**.
- `wasm_activation/Cargo.toml` uses `neat-core = { workspace = true }` — the
  workspace is the single source of truth for the pin.
- The policy document exists and references the required topics.

### Step 2 — Rust tests against pinned `neat-core`

```bash
(cd wasm_activation && RUSTFLAGS="-D warnings" cargo test --lib --tests)
```

Exercises every unit test in `wasm_activation` against the `neat-core` revision
pinned in the workspace `Cargo.toml`. This is the primary parity signal: if
`neat-core` drifts away from the behaviour previously provided by the in-tree
crate, a test here fails.

**Expected artefact:** `test result: ok.` line with zero failures across every
module (`squash`, `simd`, `accumulate`, `score_scan`, `topology_ops`,
`pc_inference`, `pc_learning`, `elastic_distribution`, `fused_error`,
`unsquash`, `training_state`, `topological_backprop`, `range`, `network`,
`synapse_type`, `error`, `derivative`).

### Step 3 — Deno parity tests

```bash
deno test --allow-read --allow-env --allow-ffi --config ./deno.json \
  test/score/WasmJsScoreParity.ts \
  test/costs/MSE.ts
```

Runs the TypeScript-side tests that cross the native boundary:

- `test/score/WasmJsScoreParity.ts` — deterministic synthetic creature scored
  end-to-end via the WASM activation module. Asserts finiteness, non-negativity,
  and the score bound (≤ 1).
- `test/costs/MSE.ts` — Mean Squared Error cost used throughout scoring. Any
  drift between `neat-core`'s MSE implementation (via WASM) and the TS cost
  surface shows up here.

**Expected artefact:** `ok | N passed | 0 failed` in the Deno test summary.

## Release checklist

Use this checklist when removing in-tree native Rust in favour of the external
`neat-core`:

1. **Pin** — confirm the workspace `Cargo.toml` pins `neat-core` to an immutable
   40-character SHA from NEAT-AI-core `Develop`.
2. **Refresh** — `cargo update -p neat-core` and commit the updated
   `Cargo.lock`.
3. **Parity gate** — run `./scripts/parity-gate.sh`. All three steps must pass
   (no skips) for sign-off.
4. **Full quality gate** — run `./quality.sh`. This is the release-wide check;
   parity gate is a narrower pre-removal filter.
5. **Rust MSRV** — verify that `scripts/rustlib.sh` `RUST_MSRV` is at least the
   minimum required by the pinned `neat-core` revision. Contributors on older
   stable toolchains must upgrade before they can build.
6. **Evidence** — paste the final `parity-gate.sh` output into the removal PR,
   including the test counts and the pinned `rev`.
7. **Sign-off** — record maintainer approval on the removal issue (see issue
   #2341). Do not merge until the approval is in writing.

## Failure response

If any step fails:

- **Do not** proceed with the removal PR.
- File (or update) a blocker on issue #2341 naming the failing test.
- If the failure is a behaviour drift in `neat-core`, fix it in NEAT-AI-core and
  bump the rev here; do **not** patch the in-tree crate to work around it.
- Re-run the parity gate; only a clean pass unblocks removal.

## Related documents

- [AGENTS.md](../AGENTS.md) — contributor guide, including the quality gate
  overview.
- [docs/CORE_DEPENDENCY_POLICY.md](CORE_DEPENDENCY_POLICY.md) — ADR for how
  NEAT-AI consumes NEAT-AI-core.
- [docs/EXTERNAL_NEAT_AI_CORE.md](EXTERNAL_NEAT_AI_CORE.md) — day-to-day
  workflow for bumping the pinned revision.
- [docs/CI_EXTERNAL_NEAT_AI_CORE.md](CI_EXTERNAL_NEAT_AI_CORE.md) — CI plumbing
  for git auth and Rust caches.
