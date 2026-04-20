## Summary

Added `docs/WASM_ACTIVATION_PARITY_AUDIT.md` recording the audit of
`wasm_activation/src/*.rs` against the pinned external `neat-core`. Every
`mod …` and `use …` in every file is mapped to its resolution source (local
module, WASM ABI crate, SIMD intrinsic, or stdlib). Closes #2369.

Key findings:

- 17 of 19 files in `wasm_activation/src/` are at full parity with the
  external crate per the sibling [#2367 audit](./NEAT_AI_CORE_PARITY_AUDIT.md)
  and will collapse to thin `pub use neat_core::…` re-exports when Issue
  #2346 lands. They do not require new upstream work.
- Two files — `topological_backprop.rs` (#1954) and `topology_ops.rs` (#1959,
  #1960, #1961) — contain inner algorithm bodies that are not WASM-specific
  and do not yet exist in `neat-core` at the pinned rev. Only the outer
  `#[wasm_bindgen]` surface and the binary-packed ABI of
  `propagate_topological` are genuinely WASM-specific.
- Filed upstream issues:
  [NEAT-AI-core#8](https://github.com/stSoftwareAU/NEAT-AI-core/issues/8)
  (topology helpers) and
  [NEAT-AI-core#9](https://github.com/stSoftwareAU/NEAT-AI-core/issues/9)
  (topological backprop loop + `NeuronType` constants).
- `wasm_activation/build.sh` passes against the current pinned rev
  `36ac4ea34fcd4e89d9fad3d6fae9efc5f02c8959`, confirming every `mod …` in
  `lib.rs` resolves cleanly.

## Evidence

Documentation-only change — no UI or performance surface. Evidence is the
parity table in `docs/WASM_ACTIVATION_PARITY_AUDIT.md` (cross-references
every `use`/`mod` against its resolution source), plus the two upstream
issues filed on NEAT-AI-core.

WASM build excerpt:

```
Compiling wasm_activation v0.1.0
    Finished `release` profile [optimized] target(s) in 6.39s
[INFO]: ✨   Done in 7.66s
[INFO]: 📦   Your wasm pkg is ready to publish at …/wasm_activation/pkg.
```

## Test Plan

- [x] `wasm_activation/build.sh` succeeds against the pinned `neat-core` rev.
- [x] `./quality.sh --lint-only < /dev/null` passes (format, lint, bash).
- [x] Upstream issues filed against `stSoftwareAU/NEAT-AI-core` for the two
      stranded files: #8 and #9.
- [x] Audit doc linked from this PR and from the closing issue comment.

## Acceptance criteria

- [x] Every `mod …` and `use …` in `wasm_activation/src/*.rs` mapped to its
      resolution source.
- [x] Non-WASM-specific logic stranded in `wasm_activation` has corresponding
      upstream issues in `stSoftwareAU/NEAT-AI-core`
      (NEAT-AI-core#8, NEAT-AI-core#9).
- [x] `wasm_activation/build.sh` succeeds against the pinned `neat-core` rev.
- [x] `./quality.sh --lint-only` and the WASM build step both pass.
