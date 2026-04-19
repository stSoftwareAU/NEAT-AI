## Summary
Adds the ShellCheck Lint GitHub Actions workflow (`.github/workflows/shellcheck.yml`) so every PR targeting `Develop` is gated by `shellcheck --severity=warning` over all shell scripts in the repository. To make the new gate pass on the current workspace, two pre-existing SC2206 word-splitting warnings in `scripts/rustlib.sh` are fixed by switching to `IFS='.' read -ra` (no behavioural change — all existing `RustlibVersionCompare` tests still pass). Closes #2361.

## Evidence
This is a CI/backend change with no UI, so no screenshot is attached. Evidence of correctness:

- `shellcheck --severity=warning` now exits 0 across all seven shell scripts: `bench/binaryFormat/run.sh`, `quality.sh`, `scripts/parity-gate.sh`, `scripts/rustlib.sh`, `scripts/rust-ci-git-auth.sh`, `scripts/rust-ci-cache-key.sh`, `wasm_activation/build.sh`.
- `./quality.sh --lint-only` passes (deno fmt, deno lint, bash syntax all green).
- Full `test/scripts/*.ts` suite (72 tests) passes, including the new `ShellCheckLint.ts` tests and the existing `RustlibVersionCompare.ts` cases that cover the refactored version-compare helper.

## Test Plan
- Added `test/scripts/ShellCheckLint.ts` with two cases:
  - `all shell scripts pass shellcheck --severity=warning` — enumerates every `*.sh` in the repo (excluding `.git`, `target`, `node_modules`) and runs `shellcheck --severity=warning` against them. Skips gracefully if `shellcheck` is not installed.
  - `shellcheck workflow file exists and is well-formed` — asserts the workflow file is present, uses `ludeeus/action-shellcheck`, triggers on `pull_request`, and sets `severity: warning`.
- Re-ran `test/scripts/RustlibVersionCompare.ts` (9 cases) to confirm the `IFS='.' read -ra` refactor preserves behaviour for equal/higher/lower major/minor/patch, pre-release suffix stripping, and short-vs-long versions.
- Re-ran `test/scripts/BashScriptSyntax.ts` (3 cases) to confirm `scripts/rustlib.sh` remains sourceable.
