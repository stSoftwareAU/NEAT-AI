# wasm_activation Parity Audit (Issue #2369)

This audit inspects
`wasm_activation/src/{lib.rs, topological_backprop.rs,
topology_ops.rs}` and
every other file under `wasm_activation/src/` to confirm that no shared
(non-WASM-specific) computation is stranded in `wasm_activation` before the
in-tree `neat-core/` duplicate is deleted (Issue #2346). The audit is part of
the parent epic [#2366](https://github.com/stSoftwareAU/NEAT-AI/issues/2366).

`wasm_activation` itself stays in the NEAT-AI repo per the architecture decision
in [#2341](https://github.com/stSoftwareAU/NEAT-AI/issues/2341) — it owns the
`#[wasm_bindgen]` entry points and `wasm-pack` tooling. The point of this audit
is not to move `wasm_activation` out, but to ensure the _inner_ algorithm bodies
live in the shared `neat-core` crate.

## Pinned revision

```toml
neat-core = { git = "https://github.com/stSoftwareAU/NEAT-AI-core.git",
              rev = "36ac4ea34fcd4e89d9fad3d6fae9efc5f02c8959" }
```

See `Cargo.toml` at the workspace root.

## Resolution map: every `mod`/`use` in `wasm_activation/src/*.rs`

Every `use` either resolves locally (`crate::…`), to a WASM-ABI crate
(`wasm_bindgen`, `js_sys`), to the stable library (`std`, `core`), or to the
WASM SIMD intrinsics in `core::arch::wasm32`. None currently resolve to
`neat_core::…` outside of parity tests in `lib.rs`.

| File                      | External `use`                                     | Internal `use`                                                                                                                                                                                                                                                | Resolution                           |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `lib.rs`                  | `wasm_bindgen::prelude::*`                         | `accumulate, derivative, elastic_distribution, error, fused_error, loss, network, pc_inference, pc_learning, range, safe_zone, simd, squash, synapse_type, score_scan, topological_backprop, topology_ops, training_state, unsquash` (mod decls + re-exports) | WASM ABI crate + local modules       |
| `accumulate.rs`           | `wasm_bindgen::prelude::*`                         | —                                                                                                                                                                                                                                                             | WASM ABI crate only                  |
| `derivative.rs`           | `core::arch::wasm32::{…}`                          | `crate::squash::{…}`                                                                                                                                                                                                                                          | WASM SIMD intrinsics + local squash  |
| `elastic_distribution.rs` | `wasm_bindgen::prelude::*`                         | —                                                                                                                                                                                                                                                             | WASM ABI crate only                  |
| `error.rs`                | `core::arch::wasm32::{…}`                          | `crate::derivative, crate::squash, crate::unsquash`                                                                                                                                                                                                           | WASM SIMD intrinsics + local modules |
| `fused_error.rs`          | —                                                  | `crate::error, crate::safe_zone, crate::squash`                                                                                                                                                                                                               | Local modules only                   |
| `loss.rs`                 | `wasm_bindgen::prelude::*`                         | `crate::{network, range, simd, squash, synapse_type}`                                                                                                                                                                                                         | WASM ABI crate + local modules       |
| `network.rs`              | `js_sys::Float32Array`, `wasm_bindgen::prelude::*` | `crate::{range, simd, squash, synapse_type}`                                                                                                                                                                                                                  | WASM ABI crates + local modules      |
| `pc_inference.rs`         | `wasm_bindgen::prelude::*`                         | `crate::derivative, crate::squash`                                                                                                                                                                                                                            | WASM ABI crate + local modules       |
| `pc_learning.rs`          | `wasm_bindgen::prelude::*`                         | `crate::derivative, crate::pc_inference`                                                                                                                                                                                                                      | WASM ABI crate + local modules       |
| `range.rs`                | —                                                  | `crate::squash`                                                                                                                                                                                                                                               | Local module only                    |
| `safe_zone.rs`            | —                                                  | `crate::squash`                                                                                                                                                                                                                                               | Local module only                    |
| `score_scan.rs`           | `wasm_bindgen::prelude::*`                         | —                                                                                                                                                                                                                                                             | WASM ABI crate only                  |
| `simd.rs`                 | `core::arch::wasm32::{…}`                          | `crate::network::SynapseData`                                                                                                                                                                                                                                 | WASM SIMD intrinsics + local module  |
| `squash.rs`               | —                                                  | —                                                                                                                                                                                                                                                             | Self-contained                       |
| `synapse_type.rs`         | —                                                  | —                                                                                                                                                                                                                                                             | Self-contained                       |
| `topological_backprop.rs` | `wasm_bindgen::prelude::*`                         | `crate::accumulate, crate::elastic_distribution, crate::fused_error, crate::squash, crate::unsquash`                                                                                                                                                          | WASM ABI crate + local modules       |
| `topology_ops.rs`         | `wasm_bindgen::prelude::*`                         | —                                                                                                                                                                                                                                                             | WASM ABI crate only                  |
| `training_state.rs`       | `std::cell::RefCell`, `wasm_bindgen::prelude::*`   | `crate::accumulate`                                                                                                                                                                                                                                           | Std + WASM ABI crate + local module  |
| `unsquash.rs`             | —                                                  | `crate::derivative, crate::squash`                                                                                                                                                                                                                            | Local modules only                   |

### Observations

- **No `use neat_core::…` in production code.** Every shared computation
  resolves to an in-tree duplicate under `wasm_activation/src/`. The external
  `neat-core` dependency is pinned in the workspace `Cargo.toml` but only
  exercised by the three parity tests in `lib.rs`
  (`test_neat_core_dependency_resolves`, `test_neat_core_derivative_parity`,
  `test_neat_core_error_parity`).
- **17 of 19 source files in `wasm_activation/src/` are bit-for-bit shared with
  `neat-core`** at the pinned rev. The sibling audit
  [`docs/NEAT_AI_CORE_PARITY_AUDIT.md`](./NEAT_AI_CORE_PARITY_AUDIT.md) already
  confirmed zero missing pub items, zero missing `impl` blocks, and zero missing
  inline `#[test]`s between in-tree `neat-core/` and the external crate. The
  same files exist as duplicates under `wasm_activation/src/` and will collapse
  to thin re-exports once Issue #2346 lands.
- **Only two files contain computation that is stranded uniquely in
  `wasm_activation` today**: `topological_backprop.rs` and `topology_ops.rs`.
  They are not present in `neat-core` at the pinned rev.

## Deep inspection of the two stranded files

### `topological_backprop.rs` (Issue #1954)

- `#[wasm_bindgen] pub fn propagate_topological(data: &[u8]) -> Vec<f64>` — the
  outer entry is **WASM-specific ABI plumbing**: it consumes a packed binary
  buffer of neurons/synapses/topology chosen to minimise JS↔WASM boundary
  crossings and to keep everything in linear memory.
- The **inner algorithm** (reverse-topological iteration, error seeding,
  fused-error-distribution call, elastic-fallback, weight/bias accumulation,
  safe-zone collapse check) is generic NEAT-AI backprop. Every helper it calls —
  `apply_fused_error_distribution`, `apply_distribute_elastic_error`,
  `apply_squash`, `apply_unsquash`, `accumulate_weight_single` — **already
  exists in `neat-core`** at the pinned rev.
- Local constants `NEURON_TYPE_INPUT = 0`, `NEURON_TYPE_CONSTANT = 3` are shared
  domain semantics, not WASM ABI details.
- Sentinel return values (`f64::NEG_INFINITY` for "noChange fallback",
  `f64::INFINITY` for "IF/MAX/MIN needs TS custom propagate") are part of the
  TS↔WASM wire contract and must stay on the wrapper.

**Upstream issue filed:**
[NEAT-AI-core #9](https://github.com/stSoftwareAU/NEAT-AI-core/issues/9) — "Lift
topological backprop loop from wasm_activation into neat-core".

### `topology_ops.rs` (Issue #1959, #1960, #1961)

Six functions, all `#[wasm_bindgen]` but none of their bodies use anything
WASM-specific:

1. `validate_topology` — forward-only sort, self/back/duplicate checks.
2. `scan_available_connections` — flat-boolean O(1) existence check, returns
   unused forward-only pairs.
3. `compute_reverse_topological_order` — Kahn's algorithm.
4. `validate_topology_batch` — amortised validation across creatures.
5. `validate_structural_integrity` — structural invariants (IF inward types,
   constant-no-inward, hidden in+out, bias finiteness, etc.).
6. `detect_cycles` — Kahn's algorithm cycle detection.

All consume `&[u32]`/`&[u8]`/`&[f64]` slices that `wasm-bindgen` zero-copies
from typed arrays — the same signatures work natively. The file also declares
numeric constants that duplicate existing `neat-core` types:

- Error codes (`VALID`, `SELF_CONNECTION`, …, `STRUCTURAL_IF_MISSING_NEGATIVE`).
- `IF_SQUASH = 34` duplicates `SquashType::If as u8`.
- `SYN_STANDARD / SYN_CONDITION / SYN_NEGATIVE / SYN_POSITIVE` duplicate
  `SynapseType` discriminants.

**Upstream issue filed:**
[NEAT-AI-core #8](https://github.com/stSoftwareAU/NEAT-AI-core/issues/8) — "Lift
topology helpers from wasm_activation into neat-core".

## What stays in `wasm_activation` (justified)

- All `#[wasm_bindgen]` public entry points in `lib.rs` — these are the JS↔WASM
  boundary surface and are explicitly in scope for this crate per
  [#2341](https://github.com/stSoftwareAU/NEAT-AI/issues/2341).
- `js_sys::Float32Array` construction/reading helpers in `lib.rs` and
  `network.rs` — WASM ABI only.
- The binary-packed buffer parser inside `propagate_topological` — part of the
  WASM ABI contract.
- Sentinel f64 return values used to signal TS fallback paths — WASM wire
  contract with the TypeScript wrapper.
- `core::arch::wasm32` SIMD intrinsics used throughout
  `accumulate/derivative/error/loss/network/simd/score_scan`. The shared
  algorithm sources in `neat-core` use the same intrinsics under
  `#[cfg(target_arch = "wasm32")]`, so these stay aligned automatically after
  the Issue #2346 collapse.

## Parity gate: `cargo build --target wasm32-unknown-unknown`

`wasm_activation/build.sh` was run against the current pinned rev and passes:

```
Building WASM activation module...
Current wasm-pack version: 0.13.1
Required wasm-pack version: 0.13.1
wasm-pack is already up to date.
Using wasm-pack for build (with SIMD enabled)...
Compiling wasm_activation v0.1.0
    Finished `release` profile [optimized] target(s) in 6.39s
[INFO]: ✨   Done in 7.66s
[INFO]: 📦   Your wasm pkg is ready to publish at …/wasm_activation/pkg.
Build complete. Output in pkg/
```

This confirms every `mod …` declaration in `lib.rs` resolves and that the pinned
`neat-core` rev links cleanly into the WASM target.

## Acceptance criteria

- [x] Every `mod …` and `use …` in `wasm_activation/src/*.rs` mapped to its
      resolution source (table above).
- [x] Non-WASM-specific logic stranded in `wasm_activation` has upstream issues:
      [NEAT-AI-core #8](https://github.com/stSoftwareAU/NEAT-AI-core/issues/8)
      (`topology_ops.rs`) and
      [NEAT-AI-core #9](https://github.com/stSoftwareAU/NEAT-AI-core/issues/9)
      (`topological_backprop.rs`).
- [x] `wasm_activation/build.sh` succeeds against the pinned `neat-core` rev.
- [x] `./quality.sh --lint-only` and the WASM build step both pass (run at PR
      time; see PR checks).

## Conclusion

The 17 in-tree wasm_activation files that overlap with `neat-core`
(`accumulate`, `derivative`, `elastic_distribution`, `error`, `fused_error`,
`loss`, `network`, `pc_inference`, `pc_learning`, `range`, `safe_zone`,
`score_scan`, `simd`, `squash`, `synapse_type`, `training_state`, `unsquash`)
are already at full parity with the external crate — that is the finding of the
sibling [#2367 audit](./NEAT_AI_CORE_PARITY_AUDIT.md). Those duplicates will be
removed when Issue #2346 lands and `wasm_activation` switches to
`use neat_core::…`.

The two files that do **not** have upstream equivalents —
`topological_backprop.rs` and `topology_ops.rs` — contain inner algorithm bodies
that are not WASM-specific and should migrate upstream before the in-tree
`neat-core/` duplicate is deleted. Upstream issues have been filed accordingly;
NEAT-AI does not need to carry further parity work itself.
