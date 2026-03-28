## Summary

Renamed `wasm_activation/pkg/.build-fingerprint` to `build-fingerprint`
(non-hidden) so it follows the repository convention of not checking in hidden
files. The root `.gitignore` ignores all dotfiles (`.*`), so checked-in files
should not use a dot prefix. Closes #2072.

**Note:** `.github/workflows/wasm-build.yml` also references the old
`.build-fingerprint` filename but cannot be updated in this PR (requires the
`workflow` OAuth scope). The workflow will safely trigger a WASM rebuild on the
next run since it won't find the old fingerprint file. A follow-up update to the
workflow file is needed.

## Changes

- Renamed `wasm_activation/pkg/.build-fingerprint` to
  `wasm_activation/pkg/build-fingerprint`
- Updated `wasm_activation/build.sh` to write the fingerprint to the non-hidden
  filename
- Updated `wasm_activation/pkg/.gitignore` to allow the non-hidden filename
- Added `test/scripts/BuildFingerprint.ts` with tests verifying the convention

## Test Plan

- Added `test/scripts/BuildFingerprint.ts` with 4 tests:
  - Verifies `build.sh` references `pkg/build-fingerprint` (non-hidden)
  - Verifies `pkg/.gitignore` allows `build-fingerprint` (non-hidden)
  - Verifies the hidden `.build-fingerprint` file does not exist
  - Verifies the fingerprint file contains a valid SHA-256 hash
- All 5085 existing tests continue to pass
