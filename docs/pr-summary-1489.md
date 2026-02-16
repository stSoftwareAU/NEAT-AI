## Summary

Applied learnings from NEAT-AI-Discovery's `scripts/runlib.sh` to improve Rust
handling across all shell scripts in this repository. Closes #1489.

Key improvements:
- **Stricter error handling**: Upgraded all scripts from `set -e` to
  `set -euo pipefail`, catching undefined variables and pipeline failures
- **Shared Rust toolchain validation**: Created `scripts/rustlib.sh` with
  reusable `require_rust_tools()` function (DRY principle), sourced by
  `wasm_activation/build.sh`
- **MSRV enforcement**: Added minimum supported Rust version checking with
  automatic toolchain update, matching Discovery's approach
- **Platform-aware build tool detection**: Added Linux distro-specific guidance
  (apt/yum/dnf) and macOS Xcode Command Line Tools detection
- **Cargo PATH management**: Added `$HOME/.cargo/bin` to PATH in `quality.sh`
  so Rust tools are discoverable in non-login shells
- **Safer bash script scanning**: Excluded `.git/` and `target/` directories
  from the bash syntax check step in `quality.sh`

## Evidence

This is a CLI/scripting change with no UI output. Evidence is provided by the
passing test suite (3820 tests, 0 failures) including 12 new tests that
validate the shell script improvements.

## Test Plan

- Added `test/scripts/RustlibVersionCompare.ts` (9 tests): Exercises the
  `_version_ge` semver comparison function from `scripts/rustlib.sh` with
  equal, higher, lower, pre-release, and short version inputs
- Added `test/scripts/BashScriptSyntax.ts` (3 tests): Validates all `.sh`
  files pass `bash -n` syntax checking, verifies `scripts/rustlib.sh` is
  sourceable, and confirms `require_rust_tools` is exported as a function
