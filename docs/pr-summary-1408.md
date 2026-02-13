## Summary

Added `--help`, `--skip-tests`, `--skip-discovery`, `--lint-only`, `--check-only`,
and `--dry-run` flags to `quality.sh` for faster development iteration. The script
now shows `[N/M]` progress indicators for each step and documents exit codes.
Closes #1408.

### Changes

- **quality.sh**: Added flag parsing, `show_help()`, progress numbering, dry-run
  mode, and step-skip logic. All existing behaviour is preserved when no flags are
  provided. Added `--allow-run` to the test invocation for the new test file.
- **test/QualityScript.ts**: 11 new tests verifying `--help`, `-h`, `--dry-run`,
  `--skip-tests`, `--skip-discovery`, `--lint-only`, `--check-only`, unknown flag
  rejection, combined skip flags, exit code documentation, and progress numbering.
- **AGENTS.md**: Updated Quality Gate section to document optional flags.
- **CONTRIBUTING.md**: Added quick-reference for skip flags in the quality gate
  section.

## Evidence

This is a CLI/script change with no visual output. Evidence is provided by the
11 passing tests that exercise real script invocations and verify stdout/exit codes.

```
ok | 3024 passed (2 steps) | 0 failed
```

## Test Plan

- `test/QualityScript.ts` — 11 new tests:
  - `quality.sh --help prints usage and exits 0`
  - `quality.sh -h prints usage and exits 0`
  - `quality.sh --dry-run shows steps without executing them`
  - `quality.sh --dry-run --skip-tests omits test step`
  - `quality.sh --dry-run --skip-discovery omits discovery steps`
  - `quality.sh --dry-run --lint-only only shows fmt and lint steps`
  - `quality.sh --dry-run --check-only only shows type-check step`
  - `quality.sh rejects unknown flags`
  - `quality.sh --dry-run --skip-tests --skip-discovery combines skips`
  - `quality.sh --help output documents exit codes`
  - `quality.sh --dry-run shows progress numbering`
