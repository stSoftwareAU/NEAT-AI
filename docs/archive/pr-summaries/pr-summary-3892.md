# Assert Discovery's real `errorKind` wire spelling, and type it

## Summary

`test/ErrorGuidedStructuralEvolution/AnalyzeParallelGpuGuard.ts` asserted the
Rust **variant name** `GpuPermanent`, but NEAT-AI-Discovery derives `Serialize`
on `DiscoveryErrorKind` with `#[serde(rename_all = "snake_case")]`, so the value
that crosses the FFI boundary is `"gpu_permanent"`. The Rust identifier never
leaves the library, so that assertion could not pass on any host that actually
reaches the GPU check.

Answering the issue's fork: **neither** branch it listed is the whole story. The
`data_validation` the issue observed at `7d4081e6` was the missing `input` /
`output` widths in the stub, already fixed by Issue #3886 (`2e9dd553`). With
that payload accepted, the GPU check _is_ reached and Discovery classifies
correctly — it just spells the classification in snake_case. The Rust side has
not regressed and the guard has not been loosened: the assertion is still an
exact `assertEquals`, now against the real contract.

To stop the same class of mistake returning, `errorKind` is no longer a bare
`string`. `RUST_DISCOVERY_ERROR_KINDS` mirrors Discovery's enum in its wire
spelling, `RustParallelAnalysisResult.errorKind` is typed
`RustDiscoveryErrorKind`, and `isRustDiscoveryErrorKind` narrows an unknown
value — a newer Discovery build may emit a kind this mirror does not list.
Comparing against a Rust identifier is now a **compile-time** error rather than
a test that only reddens on a GPU-less worker.

Closes #3892.

## Evidence

Backend/FFI change — no web interface to screenshot.

Verified against the Discovery source in hand
(`NEAT-AI-Discovery/src/ffi_types/error_classification.rs` at `16402a5`):

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiscoveryErrorKind {
    GpuTransient, GpuPermanent, GpuWedged, DataValidation, Timeout,
    MemoryExhausted, IoError, InternalPanic, Cancelled, Unknown,
}
```

The response field is `pub error_kind: Option<DiscoveryErrorKind>`, so the enum
is serialised through that rename — all ten variants are mirrored, in the same
spelling.

Live run on this GPU-less worker with the Discovery library built — the guard
executes (not `ignore`d) and the strict equality holds:

```text
$ deno test -A --no-check test/ErrorGuidedStructuralEvolution/AnalyzeParallelGpuGuard.ts
⚠️  No GPU detected (no usable GPU detected).
analyzeParallel returns graceful failure when library available but GPU unavailable ... ok
analyzeParallel proceeds when requireGpu is false even without GPU ... ok
analyzeParallel with requireGpu=false returns structured Rust error when GPU unavailable (Issue #2116) ... ok
ok | 3 passed | 0 failed | 1 ignored
```

Where the two spellings live:

```mermaid
flowchart LR
    A["Rust variant<br/>DiscoveryErrorKind::GpuPermanent"]
      -->|"serde rename_all = snake_case"| B["wire JSON<br/>errorKind: \"gpu_permanent\""]
    B --> C["RustParallelAnalysisResult.errorKind<br/>: RustDiscoveryErrorKind"]
    C --> D["isRustDiscoveryErrorKind()<br/>narrows unknown builds"]
```

## Test Plan

- **Added** `test/ErrorGuidedStructuralEvolution/RustDiscoveryErrorKind.ts` —
  runs everywhere, including CI with no Discovery library, so drift back to the
  Rust identifiers fails in ordinary CI rather than only on a GPU-less worker:
  - the mirror matches `DiscoveryErrorKind` and every entry is its snake_case
    wire value;
  - `isRustDiscoveryErrorKind` accepts every wire value;
  - it rejects `"GpuPermanent"` / `"DataValidation"` (the exact regression),
    plus casing variants, `""`, `undefined`, `null`, a number and an array;
  - a real GPU-unavailable response body parses and narrows to
    `"gpu_permanent"`.
- **Modified** `test/ErrorGuidedStructuralEvolution/AnalyzeParallelGpuGuard.ts`
  — the Issue #2116 guard now asserts `"gpu_permanent"`. Still an exact
  `assertEquals`; no assertion was loosened or removed.
- `./quality.sh` passes on this worker (Discovery library present, no GPU).

## Docs

- `docs/DISCOVERY_ARCHITECTURE.md` — new "Wire spelling of `errorKind`" section.
- `docs/GPU_ACCELERATION.md` — corrected the documented `errorKind` value.
- `CHANGELOG.md` — Fixed entry for Issue #3892.
