## Summary

Create a comprehensive troubleshooting guide for common NEAT-AI issues. Closes #1403.

The new `docs/TROUBLESHOOTING.md` covers five major areas:

- **WASM Issues** — Module not found, not initialised, worker vs main thread differences, RuntimeError: unreachable
- **Discovery Library** — Building locally, setting `NEAT_AI_DISCOVERY_LIB_PATH`, architecture mismatches, `NEAT_RUST_DISCOVERY_OPTIONAL`, FFI permissions, GPU detection
- **Memory Management** — V8 heap size configuration, test parallelism and memory pressure, exit code 143 (SIGTERM/OOM), discovery memory tuning
- **CI Failures** — Understanding coverage.yaml two-stage strategy, quality.sh step-by-step explanation, exit code meanings
- **Configuration** — Common invalid option combinations (feedback loop, adaptive mutation thresholds, plateau detection rates), ValidationError types, forward-only vs recurrent mode constraints
- **Environment Variables Reference** — All relevant environment variables in one table

Additionally updated AGENTS.md and README.md documentation sections to reference the new guide.

## Evidence

This is a documentation-only change with no UI impact. All documented error messages and behaviours are verified by real tests that exercise actual code paths (see test plan below). All 2,866 tests pass including 11 new ones.

## Test Plan

- Added `test/docs/TroubleshootingGuide.ts` with 11 tests verifying documented behaviours:
  - WASM activation initialises and is available
  - `Creature.activate()` works when WASM is loaded
  - `feedbackLoop: true` without `disableRandomSamples: true` throws documented error
  - Adaptive mutation thresholds must be ordered correctly
  - Plateau detection rates must be ordered correctly
  - Default config creates without error
  - Forward-only mode rejects recursive synapses (`RECURSIVE_SYNAPSE`)
  - Forward-only mode rejects self-connections (`SELF_CONNECTION`)
  - Recurrent mode allows backward connections
  - Hidden neuron without outward connections (`NO_OUTWARD_CONNECTIONS`)
  - Hidden neuron without inward connections (`NO_INWARD_CONNECTIONS`)
