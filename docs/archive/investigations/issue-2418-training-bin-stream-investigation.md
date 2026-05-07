# Issue #2418 — Delegating TS training binary readers to NEAT-AI-core `training_bin_stream`

> **📦 Archived under
> [Issue #2575](https://github.com/stSoftwareAU/NEAT-AI/issues/2575).** This
> investigation note was moved from `docs/` to `docs/archive/investigations/`.
> The line of work has closed — read on demand for historical context. Topic
> index: [`docs/README.md`](../../README.md); entry point:
> [`README.md`](../../../README.md).
>
> **Status:** Investigation closed as `negative-result` — **no action**.
>
> **Summary:** The TypeScript per-record `seekSync` + `readSync` path in
> `src/architecture/training/` already reads the production `.bin` corpus at ~2
> GiB/s (sequential) and ~1.7 GiB/s (random sample) on Apple Silicon SSD. This
> is at or near the hardware ceiling. The new `training_bin_stream` module in
> NEAT-AI-core (PRs #28/#29) is **native-only** — it is not exported from the
> WASM bundle and could not be made to be (WASM has no synchronous file I/O).
> Bridging it through Deno FFI would _add_ per-call overhead without removing
> any measurable bottleneck. Recommendation: leave the Deno sync reader in
> place, do not migrate.

## 1. TS files that walk `.bin` training files

Confirmed via `rg "seekSync|readSync|Deno\.openSync"` across `src/`:

| File                                                                       | Pattern                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `src/architecture/training/TrainingEpoch.ts`                               | `seekSync` + `readSync` per record (hot path)                 |
| `src/architecture/training/TrainingSetup.ts`                               | `Deno.statSync` for record-count discovery, no per-record I/O |
| `src/architecture/training/TrainingSamples.ts`                             | sample-index selection only, no I/O                           |
| `src/architecture/DataSet.ts`                                              | bulk reads via `Deno.openSync` for in-memory load             |
| `src/architecture/KFoldSplitter.ts`                                        | sequential reads for fold construction                        |
| `src/architecture/CrossValidationTrainer.ts`                               | wraps the training loop, indirect I/O                         |
| `src/discovery/HoldoutValidator.ts`                                        | sequential validation reads                                   |
| `src/discovery/EnhancedDiscoveryValidator.ts`                              | sequential validation reads                                   |
| `src/architecture/ErrorGuidedStructuralEvolution/DataRecorder.ts`          | append-only writer                                            |
| `src/architecture/ErrorGuidedStructuralEvolution/DataRecorderRecording.ts` | append-only writer                                            |

Only `TrainingEpoch.ts` performs **per-record random access** during training;
the others are sequential streams.

## 2. Is `training_bin_stream` accessible from the WASM bundle?

**No.** Verified by inspecting the pinned `wasm_activation/pkg/` artefacts:

```text
$ rg "training_bin|for_each_read|read_chunk|TrainingReadMode|io_backend" \
       wasm_activation/pkg/wasm_activation.{js,d.ts}
(no matches)
```

The `wasm_activation` bundle exports only activation, compiled-network,
backprop, and training-state primitives. The `training_bin_stream` module is
gated to the native `rust_scorer` crate in NEAT-AI-core and never crosses the
WASM boundary. WASM in Deno cannot perform synchronous file I/O on its own — it
must call back into JS — so shipping `training_bin_stream` through WASM would be
impossible without exposing every read as a host call, defeating the entire
double-buffer pipelining design.

## 3. Shape of a hypothetical native integration

To use `training_bin_stream` from TypeScript today, NEAT-AI would need
**either**:

1. **A new Deno FFI bridge** (`Deno.dlopen` of a NEAT-AI-Discovery-style shared
   library) exposing `for_each_read_chunk_with_mode` as a C ABI callable. This
   means:
   - Adding a new dynamic library to the build matrix (macOS dylib, Linux .so,
     Windows .dll).
   - Marshalling a per-record callback across the FFI boundary, or allocating a
     shared chunk buffer and copying bytes back into a `Float32Array` view.
   - Wiring `NEAT_SCORER_IO_MODE` / `NEAT_SCORER_READ_BYTES` into the TS
     surface.
   - Adding parity-gate coverage and version pinning.

2. **Or a scorer-side integration** where the TS layer delegates _both_ the I/O
   and the activation to `rust_scorer` — i.e., the training loop itself moves
   into Rust. That is a much larger change and overlaps with the existing
   `RustScorerBridge` work; it is out of scope for an I/O optimisation.

The Deno FFI route adds ~1–10 µs of overhead per FFI call. At ~2 600 bytes per
record, even an idealised 100 ns per FFI call would cost ~150 ms over a 1.5
M-record epoch — a regression vs the current ~1.8 s baseline. The only way for
FFI to _win_ would be to amortise it over much larger chunks, but the TS reader
already operates at near disk-bandwidth, so the headroom does not exist.

## 4. Benchmark baseline (current Deno sync reader)

Captured by `bench/binaryFormat/TrainingEpochReader.ts` over a 1 500 000-record
fixture (3.63 GiB; 648 observations + 2 outputs per record; 2 600 bytes per
record). Apple Silicon, page cache warm by run 3.

```text
Pattern                      records         time  throughput
sequential seekSync run 1       1500000 records     2.033 s      737 758 rec/s    1829.3 MiB/s
sequential seekSync run 2       1500000 records     1.812 s      828 001 rec/s    2053.1 MiB/s
sequential seekSync run 3       1500000 records     1.534 s      978 064 rec/s    2425.2 MiB/s
random sample seekSync 1         200000 records     0.295 s      678 785 rec/s    1683.1 MiB/s
random sample seekSync 2         200000 records     0.298 s      672 067 rec/s    1666.4 MiB/s
random sample seekSync 3         200000 records     0.313 s      638 750 rec/s    1583.8 MiB/s

Mean wall-clock time:
  sequential pass over 1500000 records : 1792.8 ms
  random sample of 200000 records       : 301.8 ms
```

Interpretation:

- Sequential reads land at **~2 GiB/s** — within the same order of magnitude as
  raw NVMe sequential read on this hardware.
- Random-sample reads (the actual `TrainingEpoch.ts` pattern) sit at **~1.7
  GiB/s** with a tight standard deviation across runs.
- The page cache is warm by run 3; throughput converges to a steady ~640 k
  random records/s.

Per-epoch I/O is **not the bottleneck** for production training workloads.
Activation, backprop, and discovery dominate by orders of magnitude.

## 5. Decision

**No action.** Closing as `negative-result`.

Rationale:

1. The new core reader is native-only and cannot reach the WASM bundle.
2. A Deno FFI bridge would add per-call overhead with no I/O headroom to
   recover.
3. The current Deno `seekSync`/`readSync` already runs at ~2 GiB/s, which is at
   hardware bandwidth.
4. Project policy (Performance Task Workflow) forbids landing a
   performance-driven PR without measured improvement; no measurable improvement
   is possible here.

If at some future point training I/O becomes bottlenecked (e.g., on slower
spinning disks or networked storage), this investigation should be revisited —
but the lever pulled would more likely be larger read-ahead chunks in the
existing TS reader rather than an FFI hop.

## 6. Reproducing the benchmark

```bash
# Generate the 3.9 GB fixture once
deno run --allow-read --allow-write bench/binaryFormat/Generate.ts

# Capture the baseline
deno run --allow-read bench/binaryFormat/TrainingEpochReader.ts
```
