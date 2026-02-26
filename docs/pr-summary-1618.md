## Summary

Add diagnostic decision trees to the troubleshooting guide covering five common
training scenarios: fitness plateau, slow training, memory issues, discovery not
finding improvements, and creatures producing NaN/Infinity. Each tree provides a
structured diagnostic flow with specific `NeatOptions` keys, recommended values,
and code examples. Closes #1618.

## Changes

- Extended `docs/TROUBLESHOOTING.md` with a new "Diagnostic Decision Trees"
  section containing five decision trees:
  1. **Fitness Plateau** — covers `plateauDetection`, `mutationRate`,
     `stabilityAdaptation`, `ensembleDiversity`, and `costOfGrowth`
  2. **Training Is Slow** — covers `threads`, `workerThreadCap`,
     `trainingSampleRate`, `trainPerGen`, and `discoverySampleRate`
  3. **Memory Issues During Training** — covers `memory` (MemoryMonitor),
     WASM cache sizing, `populationSize`, and V8 heap allocation
  4. **Discovery Not Finding Improvements** — covers discovery timeouts,
     `costOfGrowth`, `discoveryMinCandidatesPerCategory`, and dataset tuning
  5. **Creatures Producing NaN or Infinity** — covers input normalisation,
     activation function selection, `weightRegularisation`,
     `biasRegularisation`, and `stabilityAdaptation`
- Updated table of contents with links to all new sections
- AGENTS.md and README.md already link to TROUBLESHOOTING.md

## Evidence

This is a documentation-only change with no code modifications. No UI, no
performance impact, and no tests to run. Verified with `./quality.sh --lint-only`
(formatting and linting pass cleanly).

## Test Plan

- No code changes; no tests required
- Verified formatting with `deno fmt` (applied via `./quality.sh --lint-only`)
- Verified all internal anchor links are consistent within the document
