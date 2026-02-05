# PR Summary: Plan to Improve Memetic Evolution (#1321)

## Summary

This PR completes the planning phase for improving the memetic evolution system.
A comprehensive analysis of the current implementation was conducted, and 10
GitHub issues were created detailing specific, actionable improvements.

## Analysis Conducted

The memetic evolution implementation was studied across the following key files:

- `src/blackbox/FineTune.ts` - Core fine-tuning logic with quantum adjustment
- `src/blackbox/FineTunePopulation.ts` - Population generation for fine-tuning
- `src/blackbox/MemeticInterface.ts` - Data structures for memetic information
- `src/blackbox/MemeticUpdate.ts` - Inheritance of memetic data during breeding
- `src/blackbox/RestoreSource.ts` - Backtracking via memetic restoration
- `src/blackbox/Retry.ts` - Retry mechanism with forward/backward filtering
- `src/propagate/ElasticDistribution.ts` - Minimum-change error distribution
- `src/propagate/BackPropagation.ts` - Learning rate strategies and
  configuration

## Current Implementation Strengths

The analysis identified these well-engineered aspects:

1. **Quantum Discretisation**: MIN_STEP (0.000_000_1) prevents floating-point
   creep
2. **Elastic Backpropagation**: Minimum-change heuristic with safe-zone
   awareness
3. **Multi-Source Fine-Tuning**: Comparisons with previous fittest, species
   members, restored sources
4. **Non-Destructive Exploration**: Generates variants without modifying
   originals
5. **Retry/Backtrack Mechanism**: Can recover from wrong evolutionary directions

## Created Sub-Issues

### Fine-Tuning Enhancements

| Issue | Title                                | Description                                     |
| ----- | ------------------------------------ | ----------------------------------------------- |
| #1323 | Adaptive fine-tuning population size | Dynamically adjust based on success rate        |
| #1330 | Configurable quantum step size       | Adaptive step sizing based on training progress |
| #1331 | Bias-weight coordination             | Coordinated quantum adjustments for efficiency  |

### Memetic Data Management

| Issue | Title                                 | Description                                       |
| ----- | ------------------------------------- | ------------------------------------------------- |
| #1324 | Multi-generational ancestral learning | Track multiple generations of weight history      |
| #1326 | Partial memetic inheritance           | Preserve memetic data across structural mutations |

### Algorithm Improvements

| Issue | Title                                | Description                                 |
| ----- | ------------------------------------ | ------------------------------------------- |
| #1325 | Gradient-informed quantum adjustment | Use backprop gradient information           |
| #1327 | Intelligent retry selection          | Learn from historical retry success/failure |
| #1328 | Species-aware fine-tuning comparison | Better comparison target selection          |
| #1329 | Coupling fine-tuning with discovery  | Integrate memetic and discovery processes   |

### Diagnostics

| Issue | Title                              | Description                         |
| ----- | ---------------------------------- | ----------------------------------- |
| #1332 | Memetic statistics and diagnostics | Comprehensive tracking for analysis |

## Evidence

This is a planning/analysis task. The deliverables are:

- 10 detailed GitHub issues created with requirements
- Comment on parent issue #1321 summarising the findings
- No code changes required for this planning phase

Each sub-issue includes standard reminders for:

- TDD (Test-Driven Development)
- DRY principles
- Unit tests for functionality
- Benchmarks for performance claims (where applicable)
- Australian English spelling

## Test Plan

No code changes were made in this planning PR. Each created sub-issue will have
its own test plan when implemented:

- **Unit tests**: Each improvement will require tests verifying correct
  behaviour
- **Benchmarks**: Performance improvements will require benchmark evidence
  before/after

## Why Memetic Evolution May Work Better Than Backpropagation

The analysis suggests several reasons the memetic approach may outperform pure
backpropagation:

1. **Exploration vs Exploitation**: Memetic evolution explores multiple
   directions simultaneously (population-based) while backpropagation follows a
   single gradient path
2. **Non-Greedy Updates**: Quantum adjustments include randomness, avoiding
   local minima
3. **Structural Awareness**: Fine-tuning operates on creatures with evolved
   structure, not fixed architectures
4. **Ancestral Learning**: Memetic data preserves successful weight patterns
   across generations
5. **Retry Mechanism**: Ability to backtrack from unsuccessful directions
