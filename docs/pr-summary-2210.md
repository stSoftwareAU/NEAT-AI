## Summary

Updated all documentation to reflect recent improvements, primarily covering
the MCMC acceptance criterion (Issues #2199–#2202), advanced breeding strategies
(Issues #2175–#2183), and WASM panic recovery (Issues #2207, #2212). Closes #2210.

### Changes

- **mod.ts**: Export `MCMCConfig`, `RequiredMCMCConfig`, and
  `DEFAULT_MCMC_CONFIG` from the public API
- **docs/CONFIGURATION_GUIDE.md**: Add MCMC Acceptance Criterion section with
  all configuration options, defaults, and usage examples
- **docs/API_REFERENCE.md**: Add section 19 (MCMC Acceptance Criterion) with
  type references, configuration table, and usage patterns
- **README.md**: Add feature highlights for MCMC Mutation Acceptance (#20) and
  Advanced Breeding Strategies (#21)
- **AGENTS.md**: Add MCMC acceptance and horizontal gene transfer to the
  terminology glossary
- **docs/TROUBLESHOOTING.md**: Add WASM Panic Recovery section documenting
  graceful panic handling in fitness evaluation and disposal

## Evidence

All 5457 tests pass, including new documentation accuracy tests that verify
documented defaults match actual code values.

## Test Plan

- Added `test/config/MCMCConfigDocumentation.ts` — verifies MCMCConfig is
  properly exported from mod.ts and defaults match documentation
- Added MCMC defaults test to `test/config/ConfigurationGuideDefaults.ts` —
  verifies CONFIGURATION_GUIDE.md default values match code
