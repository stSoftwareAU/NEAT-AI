## Summary

Updated COMPARISON.md to reflect recent improvements and archived all PR summary
files. Closes #2234.

### COMPARISON.md Updates

Added documentation for the following recent improvements:

- **MCMC Mutation Acceptance**: Metropolis-Hastings acceptance criterion with
  adaptive temperature tuning (new unique approach section)
- **Advanced Breeding Strategies**: Input-weight crossover, subgraph
  transplantation (horizontal gene transfer), diversity-driven breeding, and
  cosine similarity neuron alignment (new unique approach section)
- **Synthetic Synapse Training**: Temporary layer densification during
  backpropagation (new unique approach section)
- **WASM Panic Recovery**: Graceful handling of WASM unreachable panics during
  evolution
- **Forward-Only Topology Enforcement**: Unconditional validation after creature
  initialisation with DEBUG-gated assertions
- **Numerical Stability**: Activation function output clamping in both
  TypeScript and Rust WASM
- Updated "What We've Implemented", "Training Paradigms", "Unique Approaches",
  "Ecosystem Comparison", "Pros and Cons", "References", and "Conclusion"
  sections
- Added new reference sections for MCMC and horizontal gene transfer

### PR Summary Archival

Moved 112 PR summary files from `docs/` to `docs/archive/pr-summaries/` to keep
the docs directory clean.

## Evidence

Documentation-only change. No code changes — only markdown updates and file
moves.

## Test Plan

- Verified `./quality.sh --lint-only` passes (formatting and linting)
- No code changes requiring unit tests
