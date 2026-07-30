# PR #3548 — CI fix: "Merge coverage & results" (3 shards reported test failures)

## Failure

The `Merge coverage & results` job exited 1 with
`❌ 3 shard(s) reported test failures`. Shards 0, 1 and 6 each recorded
`failed`; the merged `junit.xml` held **9 failures** across three files, from
two independent root causes.

## Root cause 1 — the vendored `pkg/.gitignore` was clobbered

Commit `c7521928` accidentally committed the wasm-pack-generated
`wasm_activation/pkg/.gitignore` (a blanket `*`), replacing this repo's curated
allowlist. `build.sh`'s `extract_bundle` unpacks the upstream tarball straight
over `pkg/`, and wasm-pack ships that `*` file inside the bundle.

With everything in `pkg/` ignored, `deno publish` dropped the vendored WASM
artefacts, so JSR consumers would 404 on `wasm_activation.js`.

Failures: `test/scripts/BuildFingerprint.ts` (1),
`test/wasm/WasmPublishIncluded.ts` (1).

**Fix**

- Restored the curated `wasm_activation/pkg/.gitignore` allowlist.
- `extract_bundle` now excludes `.gitignore` from extraction, so the upstream
  bundle can never overwrite this repo's ignore policy again. No manifest entry
  covers `.gitignore`, so nothing else is affected.
- Regression test `test/scripts/BuildScriptGitignorePreserved.ts` drives the
  real `extract_bundle` against a fixture tarball carrying wasm-pack's `*`; it
  fails against the unfixed `build.sh` and passes after.

## Root cause 2 — the activation trap site moved into the Rust constructor

`test/wasm/WasmActivationTrapGuardIssue2658.ts` reproduced a WASM trap by
hand-building a binary whose synapse points at neuron 9999, relying on the
constructor accepting it and `activate()` trapping. The core rev this milestone
bumps to (`7eaa332`) now rejects that shape up front —
`Synapse source index 9999 is out of bounds for a network with 3 nodes` — so
`WasmCreatureActivation.create()` returns `null` and the seven trap-guard tests
died in setup. No constructor-accepted binary reaches an activation-time trap
any more (verified against out-of-range, unknown-squash and short-header
variants).

**Fix**: build a well-formed binary, create a real `WasmCreatureActivation`,
then swap its compiled kernel for a stub whose entry points throw the same
`WebAssembly.RuntimeError` the real kernel raises. The contract under test —
every `activate*` converts a raw trap into a typed
`WasmError("ACTIVATION_FAILED")`, while pre-flight `WasmError`s propagate
untouched — is unchanged, and all pre-flight checks plus
`invalidateAfterWasmPanic` still run exactly as in production. This mirrors the
note already in the file for Issue #2667, where the `from_index` check moved
into the producer validator.

Failures: `test/wasm/WasmActivationTrapGuardIssue2658.ts` (7).

## Verification

- The 16 tests across the four affected files: all pass (were 9 failing).
- `test/scripts/*.ts` + `test/ci/*.ts`: 314 passed.
- `shellcheck build.sh`, `deno fmt`, `deno lint`: clean.
- `./quality.sh`: fmt, lint, shellcheck, type-check and the suite all pass, with
  the 9 failures gone. Four `ErrorGuidedStructuralEvolution` Discovery tests
  fail on this laptop both with and without these changes — they need the
  optional Rust Discovery library and self-skip in CI
  (`NEAT_RUST_DISCOVERY_OPTIONAL=true`), where they are reported as `skipped` in
  this PR's `junit.xml`. Unrelated and untouched.
