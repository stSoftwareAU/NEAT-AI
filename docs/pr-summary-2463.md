# PR Summary — Pin NEAT-AI-core to fix WASM `propagate_topological` regression (Issue #2463)

## Summary

Closes #2463.

Advance `deno.json` `neatCore.rev` from `36ac4ea34fcd4e89d9fad3d6fae9efc5f02c8959` to `925d4b7fb8381ad1e162e2b76f4c4d2ec11b52f3` and refresh `wasm_activation/pkg/**` to pick up the cross-repo fix landed in `stSoftwareAU/NEAT-AI-core` PR #52.

The Rust-side fix corrects a byte-packed ABI mis-alignment in `wasm_exports::wasm_propagate_topological` that produced the `RuntimeError: unreachable` trap reported in #2461 and #2459. Diagnosis lived in #2461; the actual code change lives in NEAT-AI-core PR #52.

## Cross-repo work

| Repo | What changed |
|------|--------------|
| `stSoftwareAU/NEAT-AI-core` (PR #52, merged) | Extracted byte-packed decoder into `neat-core/src/propagate_codec.rs`, corrected `HEADER_BYTES` 40→36 and `NEURON_RECORD_BYTES` 20→24, and made the decoder read `adjusted_bias` instead of zeroing it. Added 6 native unit tests covering the round-trip and trap surface. |
| `stSoftwareAU/NEAT-AI` (this PR) | Pin `neatCore.rev` to the new core SHA, refresh vendored `wasm_activation/pkg/**`, verify the trap is gone with the existing `docs/evidence/2461-repro.ts` and the previously-failing propagate test suite. |

The new core SHA is published as `wasm-bundle-925d4b7fb8381ad1e162e2b76f4c4d2ec11b52f3` (asset: `wasm_activation-pkg.tar.gz`) — see <https://github.com/stSoftwareAU/NEAT-AI-core/releases/tag/wasm-bundle-925d4b7fb8381ad1e162e2b76f4c4d2ec11b52f3>.

## Root cause

The TS encoder in `src/propagate/WasmTopologicalBackprop.ts` is the canonical contract (Issue #1954):

| Section | TS encoder | Old Rust decoder | Fixed Rust decoder |
|---------|-----------|------------------|--------------------|
| Header | `HEADER_SIZE = 36` | `HEADER_BYTES = 40` | `HEADER_BYTES = 36` |
| Per-neuron | `NEURON_STRIDE = 24` (incl. `adjusted_bias` f32) | `NEURON_RECORD_BYTES = 20`, `adjusted_bias = 0.0` | `NEURON_RECORD_BYTES = 24`, reads `adjusted_bias` from `base + 20` |

After the lifted decoder was off by 4 bytes at the start of the buffer and 4 bytes per neuron, every later read drifted into junk. `synapse.from`/`synapse.to` and `reverse_topo_order` ended up pointing past `neurons.len()`, the bounds check panicked, and `wasm-pack` lowered the panic to `unreachable` at `wasm_activation_bg.wasm:1:184056` — exactly the offset reported in the original trap stack.

## Evidence

### 1. Minimal repro from #2461 now passes

```bash
$ deno run -A docs/evidence/2461-repro.ts
OK — propagate_topological returned without trapping
```

Before this PR, the same script hit `RuntimeError: unreachable`.

### 2. Previously-failing propagate tests pass

```
running 1 test from ./test/propagate/Maximum.ts
running 4 tests from ./test/propagate/SingleNeuron.ts
running 32 tests from ./test/propagate/BackpropConvergence.ts
ok | 37 passed | 0 failed (497ms)
```

These were among the 31 direct WASM traps and downstream assertion failures listed in #2461.

### 3. NEAT-AI-core regression tests would have caught the bug pre-merge

Native unit tests in `neat-core/src/propagate_codec.rs::tests` (added in NEAT-AI-core PR #52):

- `header_and_neuron_record_constants_match_ts_contract` — pins constants to TS.
- `decoder_round_trips_neuron_adjusted_bias` — verifies every `adjusted_bias` is decoded correctly.
- `end_to_end_decoder_drives_propagate_loop_without_trap` — drives `propagate_topological_loop` from a TS-shaped buffer.
- `header_too_short_returns_error` / `buffer_truncated_returns_error` / `empty_buffer_returns_header_too_short` — guard rails.

Confirmed locally that reverting just the two constants in the codec to the buggy values causes the round-trip and constants tests to fail with a junk-`f32` mismatch on `adjusted_bias` (`2.37e-38` ← raw header bytes interpreted as a float) — the same shape of error that produced the trap in WASM.

### 4. Cross-repo data flow

```mermaid
sequenceDiagram
  participant TS as WasmTopologicalBackprop.ts
  participant SHIM as wasm_propagate_topological (wasm_exports.rs)
  participant CODEC as propagate_codec.rs (NEW, native-testable)
  participant LOOP as propagate_topological_loop

  TS->>SHIM: Uint8Array (HEADER_SIZE=36, NEURON_STRIDE=24)
  SHIM->>CODEC: decode_propagate_buffer(&[u8])
  CODEC-->>SHIM: DecodedPropagate { neurons, synapses, ..., adjusted_bias }
  SHIM->>LOOP: PropagateInput<'_>
  LOOP-->>SHIM: PropagateOutput
  SHIM->>CODEC: encode_propagate_output(&output)
  CODEC-->>SHIM: Vec<f64> (sentinel-encoded)
  SHIM-->>TS: Float64Array
```

## Test Plan

- [x] `./build.sh` — refreshed `wasm_activation/pkg/**` for the new SHA.
- [x] `cat wasm_activation/pkg/neat_core_rev.txt` — `925d4b7fb8381ad1e162e2b76f4c4d2ec11b52f3`.
- [x] `deno run -A docs/evidence/2461-repro.ts` — now exits cleanly.
- [x] `deno test --allow-all test/propagate/Maximum.ts test/propagate/SingleNeuron.ts test/propagate/BackpropConvergence.ts` — 37/37 pass.
- [x] `./quality.sh --check-only` — type-check passes.
- [x] In NEAT-AI-core: `cargo test --lib propagate_codec` — 6/6 pass (and 3/6 fail when constants are reverted to the buggy values, proving the tests detect the regression).
- [x] In NEAT-AI-core: `./quality.sh` — green (fmt, clippy, build, all 233+ unit tests, doc, deny, bats).

## Files touched

```
deno.json                                  (neatCore.rev advanced)
wasm_activation/pkg/.gitignore             (regenerated by build.sh)
wasm_activation/pkg/build-fingerprint
wasm_activation/pkg/neat_core_rev.txt
wasm_activation/pkg/package.json
wasm_activation/pkg/wasm_activation.d.ts
wasm_activation/pkg/wasm_activation.js
wasm_activation/pkg/wasm_activation_bg.wasm
wasm_activation/pkg/wasm_activation_bg.wasm.d.ts
docs/pr-summary-2463.md                    (this file)
```
