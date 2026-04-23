## Summary

Harden `src/score/RustScorerBridge.ts` so the external `rust_scorer` binary is
invoked reliably from Deno and failures are diagnosable. Closes #2410.

Three behaviours changed:

1. **Subprocess environment.** The bridge no longer passes `env: {}` to
   `Deno.Command`, which left the child with an empty environment and broke
   PATH-resolved binaries. When no overrides are configured the `env` option
   is omitted entirely so the child inherits the parent environment. When
   `NEAT_AI_RUST_SCORER_ENV` overrides exist, they are merged over
   `Deno.env.toObject()` rather than replacing it.
2. **Absolute paths.** The temp creature file path and `dataDir` are both
   resolved against `Deno.cwd()` before being handed to `rust_scorer`, so
   relative callers (e.g. `.trainData-binary_115`) work even when the child
   process runs with a different cwd.
3. **Diagnostics.** On non-zero exit or non-JSON stdout, the warning line now
   includes a trimmed `stderr` (and `stdout` for parse failures) so operators
   can see messages like `Error: …` from the Rust CLI instead of only
   `exit 1`. Parsing is wrapped in `try/catch` so invalid stdout no longer
   throws — the scorer gracefully falls back to WASM scoring.

## Evidence

Backend-only change. Verified via unit tests in
`test/score/RustScorerBridgeHardening.ts`:

- `inherits parent env when no overrides configured` — runner receives
  `env: undefined` so the child inherits the parent env.
- `merges overrides with parent env when overrides exist` — runner receives
  a merged map containing a parent-set sentinel plus the override.
- `resolves creature and data paths to absolute paths` — both args passed to
  the runner satisfy `isAbsolute()` even when `dataDir` is supplied relative.
- `logs trimmed stderr on non-zero exit` — warn line includes the stderr
  snippet.
- `handles non-JSON stdout gracefully and includes stderr in warning` — no
  throw, warn line records the parse failure, result falls back to WASM.

Full suite green via `./quality.sh --skip-discovery --skip-wasm`:
`6148 passed | 0 failed | 3 ignored`.

## Test Plan

- [x] Added `test/score/RustScorerBridgeHardening.ts` with five new tests
  covering env inheritance, env merging, absolute-path resolution, stderr
  trimming on failure, and graceful handling of non-JSON stdout.
- [x] Existing `test/score/RustScorerIntegration.ts` tests continue to pass
  unchanged — the CommandRunner `env` option is now optional but compatible
  with existing call sites.
- [x] `./quality.sh --skip-discovery --skip-wasm` runs fmt, lint, type-check,
  and the full parallel test suite cleanly.
