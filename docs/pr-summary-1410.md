## Summary

Create comprehensive configuration guide documenting all NEAT-AI options with
defaults, types, ranges, and usage recipes. Closes #1410.

### Changes

- **`docs/CONFIGURATION_GUIDE.md`** — New guide covering all configuration
  sections:
  - Quick reference tables for every option (type, default, description)
  - Detailed sections for each config group: core evolution, training,
    discovery, discovery replay, discovery caching, adaptive mutation
    thresholds, plateau detection, stability adaptation, weight/bias
    regularisation, ensemble diversity, quantum step, fine-tune population, and
    logging/reproducibility
  - Validation rules and cross-field constraints
  - Five recipe configurations: fast prototyping, production training,
    research/reproducibility, time-series/recurrent, and minimal complexity
- **`AGENTS.md`** — Added configuration guide to the documentation layout
  section
- **`test/config/ConfigurationGuideDefaults.ts`** — 11 tests that import actual
  default constants and verify they match documented values, ensuring the guide
  stays in sync with source code

## Evidence

This is a documentation-only change with no UI or performance impact. The
configuration guide content is validated by 11 new unit tests that import the
real default constants from source modules and assert their values match what
the guide documents. All 3067 tests pass (including the 11 new ones).

## Test Plan

- Added `test/config/ConfigurationGuideDefaults.ts` with 11 tests:
  - Core evolution defaults match code
  - Discovery defaults match code
  - Adaptive mutation defaults match code
  - Plateau detection defaults match code
  - Stability adaptation defaults match code
  - Weight regularisation defaults match code
  - Bias regularisation defaults match code
  - Ensemble diversity defaults match code
  - Quantum step defaults match code
  - Fine-tune population defaults match code
  - Discovery replay defaults match code
- All tests verify real default values from the source config modules
- `./quality.sh` passes cleanly (3067 tests, 0 failures)
