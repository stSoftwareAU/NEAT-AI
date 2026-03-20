## Summary

Comprehensive documentation audit and update to reflect all recent enhancements.
Closes #1903.

### Changes

**PR Summary Archiving:**

- Moved 23 un-archived PR summaries (1833–1900) to `docs/archive/pr-summaries/`

**CONFIGURATION_GUIDE.md:**

- Added quick reference tables for Data Fuzzing, Cross-Validation,
  Hyperparameter Evolution, Adaptive Population Sizing, and Parallel Evaluation
- Added detailed sections with code examples for each new feature
- Added two new recipes: "Maximum Generalisation" (fuzzing + cross-validation)
  and "Self-Tuning Evolution" (hyperparameter evolution + adaptive population)
- Updated table of contents

**API_REFERENCE.md:**

- Added Transfer Learning section (exportCheckpoint, importCheckpoint,
  createSeededPopulation) with full parameter tables
- Added ONNX Export section (checkOnnxCompatibility, exportToOnnx) with usage
  examples and limitation notes
- Updated table of contents and Further Reading links

**README.md:**

- Added features 15–19: Training Data Fuzzing, K-Fold Cross-Validation,
  Hyperparameter Self-Adaptation, Transfer Learning, and ONNX Export
- Each feature includes a Wikipedia or external reference link

**TROUBLESHOOTING.md:**

- Added troubleshooting sections for Data Fuzzing and Regularisation,
  Hyperparameter Evolution, and ONNX Export Issues
- Updated table of contents

## Evidence

- All 4739 tests pass
- Lint, formatting, and type checks pass via `./quality.sh`
- Documentation-only changes — no code modifications

## Test Plan

- No new tests required (documentation-only changes)
- Verified all quality checks pass: `./quality.sh --skip-discovery --skip-wasm`
