# NEAT-AI-core Parity Gate

Issue #2345 — parity checklist that validates NEAT-AI stays aligned with the
pinned [NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core) revision.

## When to run the gate

- After bumping `deno.json` `neatCore.rev`.
- Before releases.
- Any time `wasm_activation/pkg` is refreshed.

The full `./quality.sh` remains the release-wide quality gate; the parity gate
is a focused alignment check.

## Commands

The single entry point is `scripts/parity-gate.sh`. All steps must pass before
sign-off.

```bash
# Run every step (recommended):
./scripts/parity-gate.sh

# Preview the steps without running them:
./scripts/parity-gate.sh --dry-run

# Skip selectively if a toolchain is unavailable:
./scripts/parity-gate.sh --skip-sync   # skip build.sh artifact sync
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

- `deno.json` pins `neatCore.repo` and `neatCore.rev`.
- `neatCore.rev` is a full 40-character hex SHA.
- The policy document exists and references the required topics.

### Step 2 — Sync WASM artifacts from pinned rev

```bash
./build.sh
```

Ensures `wasm_activation/pkg` is fetched directly from the pinned NEAT-AI-core
commit and includes required runtime files.

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

> [!NOTE]
> After the topology / backprop / elastic-distribution TS fallbacks were removed
> (Issues #2415, #2416), the parity gate's scope is unchanged. It still compares
> the WASM scoring path (`WasmJsScoreParity.ts`) and MSE cost surface (`MSE.ts`)
> against expected behaviour — these are the only TS-side surfaces that cross
> the native boundary in a way that could drift independently. The removed
> helpers had no remaining TS implementation to compare against, so excluding
> them from the gate is correct.

## Release checklist

Use this checklist for NEAT-AI-core repins:

1. **Pin** — update `deno.json` `neatCore.rev` to an immutable 40-char SHA.
2. **Refresh** — run `./build.sh` and commit updated `wasm_activation/pkg/**`.
3. **Parity gate** — run `./scripts/parity-gate.sh`. All three steps must pass
   (no skips) for sign-off.
4. **Full quality gate** — run `./quality.sh`. This is the release-wide check;
   parity gate is a narrower pre-removal filter.
5. **Evidence** — paste the final `parity-gate.sh` output into the PR, including
   the test counts and pinned `rev`.
6. **Sign-off** — record maintainer approval on the removal issue (see issue
   #2341). Do not merge until the approval is in writing.

## Failure response

If any step fails:

- **Do not** proceed with the removal PR.
- File (or update) a blocker on issue #2341 naming the failing test.
- If the failure is behavioural drift in NEAT-AI-core artifacts, fix it in
  NEAT-AI-core and bump the `rev` here; do **not** patch generated pkg by hand.
- Re-run the parity gate; only a clean pass unblocks removal.

## Related documents

- [AGENTS.md](../AGENTS.md) — contributor guide, including the quality gate
  overview.
- [docs/CORE_DEPENDENCY_POLICY.md](CORE_DEPENDENCY_POLICY.md) — ADR for how
  NEAT-AI consumes NEAT-AI-core.
- [docs/EXTERNAL_NEAT_AI_CORE.md](EXTERNAL_NEAT_AI_CORE.md) — day-to-day
  workflow for bumping the pinned revision.
- [docs/CI_EXTERNAL_NEAT_AI_CORE.md](CI_EXTERNAL_NEAT_AI_CORE.md) — CI plumbing
  for build.sh-driven WASM sync.
