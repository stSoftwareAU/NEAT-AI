# Replace the stale hand-maintained `src/` tree in CONTRIBUTING.md (Issue #3689)

## Summary

`CONTRIBUTING.md` hand-maintained a "Project Structure" tree listing 14 `src/`
subdirectories while the real tree has 29 — omitting `blackbox/`, `cache/`,
`deprecated/`, `multithreading/`, `neuron/`, `onnx/`, `optimize/`,
`predictiveCoding/`, `presets/`, `reconstruct/`, `score/`, `transfer/`,
`upgrade/`, `utils/` and `workers/`. It also annotated `wasm_activation/` as
"WASM activation module (Rust source + pkg)", which `CONTRIBUTING.md:186-188`
itself contradicts ("Rust/Cargo is no longer built in-tree") — the directory
contains only the vendored `pkg/` artefacts. Both defects violate the repo's own
convention at `AGENTS.md:129-134`: the per-module `src/` layout "is **not**
duplicated here — a hand-maintained tree only rots and misleads".

The block is now the same top-level-only list AGENTS.md uses, with a corrected
`wasm_activation/pkg/` annotation and a link to the AGENTS.md "Directory
Structure" section as the single source of truth. Closes #3689.

## Evidence

Documentation-only change — no web interface to screenshot. The behavioural
guard is `test/docs/ContributingProjectStructure.ts`, a sibling of the existing
`test/docs/AgentsDirectoryStructure.ts` (Issue #3285) that reads the real `src/`
layout from disk rather than grepping for fixed strings.

Before the fix (all three guards fail):

```text
CONTRIBUTING.md Project Structure embeds a partial src/ tree: 14/29 subsystems
listed, omitting [blackbox, cache, deprecated, multithreading, neuron, onnx,
optimize, predictiveCoding, presets, reconstruct, score, transfer, upgrade,
utils, workers].
CONTRIBUTING.md Project Structure should reference `src/` as the source layout
CONTRIBUTING.md must not describe wasm_activation/ as containing Rust source
FAILED | 0 passed | 3 failed
```

After the fix:

```text
ok | 3 passed | 0 failed (2ms)
```

Full gate: `./quality.sh` → `ok | 8219 passed (5 steps) | 0 failed | 4 ignored`.

## Test Plan

Added `test/docs/ContributingProjectStructure.ts` with three regression tests
that fail against the unfixed CONTRIBUTING.md:

- **Partial-tree guard** — enumerates the live `src/` subdirectories with
  `Deno.readDir` and asserts the section names either all of them or none, so a
  subset that silently omits new subsystems cannot creep back in.
- **Source-of-truth guard** — asserts the section points at `src/` and links to
  AGENTS.md rather than restating the layout.
- **WASM annotation guard** — asserts the section never describes
  `wasm_activation/` as holding Rust source, and confirms `wasm_activation/src/`
  genuinely does not exist on disk so the guard stays honest.
