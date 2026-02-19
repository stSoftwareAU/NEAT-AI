## Summary

Verified all documentation against the actual codebase and fixed numerous
discrepancies across 8 files. Closes #1548.

### Key fixes

**AGENTS.md** — Added 2 missing `src/` directories (`creature/`, `deprecated/`),
updated quality.sh from 7 to 8 steps (WASM build), added `--skip-wasm` flag.

**API_REFERENCE.md** — Fixed activation count (37 → 38), added 3 missing
activations (SQRT, SQUARE, MEAN) to the table, corrected **14 wrong default
values** in the NeatOptions tables (e.g. `mutationRate` was documented as 0.5
but is actually 0.3, `elitism` was 0.2 but is actually 1, `threads` was 1 but
defaults to hardware concurrency), added WASM cache control docs.

**CONTRIBUTING.md** — Synced quality gate steps and expanded project structure.

**COMPARISON.md** — Removed stale "new" framing of the mature `discoveryDir`
feature.

**DISCOVERY_GUIDE.md** — Replaced dead link to non-existent
`docs/DISCOVERY_API.md` with working links to actual docs, updated
troubleshooting.

**DiscoveryDir.md** — Removed reference to non-existent `src/Discovery/Scan.ts`.

**GPU_ACCELERATION.md** — Replaced bare date with a History section.

**src/methods/activations/README.md** — Added SQRT, SQUARE, MEAN to the
backpropagation strategy table.

## Evidence

This is a documentation-only change — no code was modified. Verification was
performed by reading the actual source code in `src/config/NeatConfig.ts`,
`src/methods/activations/Activations.ts`, `quality.sh`, and the `src/` directory
structure, then cross-referencing every claim in the docs.

Quality checks pass: `./quality.sh --lint-only` and
`./quality.sh --skip-tests --skip-discovery` both succeed.

## Test Plan

- No tests added or modified — this is a documentation-only change
- Ran `./quality.sh --lint-only` to verify formatting and linting pass
- Ran `./quality.sh --skip-tests --skip-discovery` to verify type-checking
  passes
