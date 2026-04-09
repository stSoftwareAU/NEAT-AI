## Summary

Renamed `wasm_activation/pkg/.build-fingerprint` to `build-fingerprint`
(non-hidden) so it follows the repository convention of not checking in hidden
files. The root `.gitignore` ignores all dotfiles (`.*`), so checked-in files
should not use a dot prefix. Closes #2072.

## Changes

- Renamed `wasm_activation/pkg/.build-fingerprint` to
  `wasm_activation/pkg/build-fingerprint`
- Updated `wasm_activation/build.sh` to write the fingerprint to the non-hidden
  filename
- Updated `wasm_activation/pkg/.gitignore` to allow the non-hidden filename
- Updated `.github/workflows/wasm-build.yml` to read `build-fingerprint`
- Removed tracked `wasm_activation/pkg/.build-fingerprint`
- Added `test/scripts/BuildFingerprint.ts` with tests verifying the convention

## Test Plan

- Added `test/scripts/BuildFingerprint.ts` with tests that verify `build.sh` and
  `pkg/.gitignore` use only the non-hidden fingerprint path, and that the hash
  file is valid when present
- All existing tests continue to pass
