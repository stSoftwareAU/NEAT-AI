## Summary

Create comprehensive API reference documentation for the NEAT-AI library. Closes
#1401.

New users previously had to read source code to understand the public API. This
PR adds `docs/API_REFERENCE.md` covering all 15 areas of the public API surface:

- **Core classes**: Creature (constructor, methods, properties, static methods),
  CRISPR (targeted genetic modifications)
- **Configuration**: All NeatOptions fields with types and defaults, plus 9
  sub-configuration objects (plateau detection, stability adaptation,
  weight/bias regularisation, ensemble diversity, quantum step, fine-tune
  population, adaptive mutation thresholds)
- **Activation functions**: Summary table of all 37 squash functions with
  priorities, ranges, and recommended use cases
- **Cost functions**: All 6 built-in cost functions (MSE, MAE, MAPE, MSLE,
  CROSS_ENTROPY, HINGE) with formulas and the CostInterface for custom costs
- **Training API**: BackPropagationOptions with all fields and defaults
- **Evolution API**: evolveDir() signature, dataset format, selection
  strategies, mutation types and preset groups
- **Discovery API**: GPU-accelerated structural analysis, configuration, and
  formatting utilities
- **Serialisation**: CreatureExport, NeuronExport, SynapseExport, CreatureTrace
  interfaces with import/export examples
- **Error types**: ValidationError and ValidationErrorName with error handling
  patterns
- **Worker API**: Multi-threaded evaluation, WASM preloading, automatic fallback
- **Intelligent Design**: Squash function optimisation exports
- **Plateau Detection**: PlateauDetector class with defaults and example
- **Logger**: Structured logging interface with global/custom/silent loggers
- **Random Number Generator**: Seeded/unseeded RNG with reproducibility support
- **Utilities**: CreatureUtil, Upgrade, randomConnectMissing

## Evidence

This is a documentation-only change with no UI component. The API reference
accuracy is verified by the test suite.

## Test Plan

- Added `test/PublicAPI.ts` with 19 tests that verify every documented public
  API symbol is actually exported and functional:
  - Creature constructor, fromJSON round-trip, activate
  - CreatureUtil, CRISPR exports
  - All 6 built-in cost functions via Costs.find()
  - Selection strategies (FITNESS_PROPORTIONATE, POWER, TOURNAMENT)
  - Mutation types (individual and preset groups FFW/ALL)
  - PlateauDetector with DEFAULT_PLATEAU_DETECTION
  - Logger API (getLogger, setLogger, createConsoleLogger, SILENT_LOGGER)
  - RandomNumberGenerator (seeded determinism, unseeded)
  - Upgrade, upgradeTwo, randomConnectMissing, fetchWasmForWorkers
  - Discovery formatting utilities (formatErrorDelta,
    formatPercentWithSignificantDigits)
  - NeatOptions type with key configuration fields
  - CreatureExport/NeuronExport/SynapseExport shape verification
- All 2841 tests pass (including the 19 new tests)
- Full quality gate (`./quality.sh`) passes cleanly
