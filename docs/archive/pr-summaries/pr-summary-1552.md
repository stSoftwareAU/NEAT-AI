## Summary

Created comprehensive Predictive Coding architecture design document at
`docs/PREDICTIVE_CODING.md`. This document serves as the blueprint for
integrating Predictive Coding (PC) as an optional training mode in NEAT-AI,
covering background theory, architecture design, integration strategy,
implementation roadmap, and academic references. Closes #1552.

## Changes

- **`docs/PREDICTIVE_CODING.md`** (new): Full design document with five
  sections:
  1. Background & Theory — PC fundamentals, energy function, two-timescale
     dynamics, local learning rules, relationship to free energy principle and
     elastic backpropagation
  2. Architecture Design — mapping onto Neuron/Synapse/Creature, state
     extensions, weight symmetry decision, inference settling algorithm, Hebbian
     learning rule, TypeScript vs Rust/WASM component allocation
  3. Integration Strategy — optional training mode, configuration design
     following established patterns, backward compatibility guarantees,
     Discovery integration
  4. Implementation Roadmap — five phased PRs with dependencies and key files
  5. References — 20 academic citations from #1549

- **`AGENTS.md`** (modified): Added `docs/PREDICTIVE_CODING.md` to the
  Documentation Layout section

## Evidence

This is a documentation-only change with no code, UI, or performance impact.
Verified with `./quality.sh --lint-only` — formatting and linting pass cleanly.

## Test Plan

- No code changes, so no tests required
- Document uses Australian English throughout (behaviour, minimise, optimise,
  serialisation, amortising)
- All architecture decisions are justified with literature references
- Integration points reference specific file paths in the codebase
