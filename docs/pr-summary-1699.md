## Summary

Add a comprehensive activation function selection guide at
`docs/ACTIVATION_FUNCTIONS.md`. Closes #1699.

The guide covers:

- **Overview table** listing all 35+ activation functions (32 standard, 3
  aggregate, 3 deprecated) with output ranges, boundedness, monotonicity, and
  mutation probabilities
- **Categories** grouping functions by output range (bounded vs unbounded) and
  differentiability
- **Selection guidance** with recommendations for output layers (by problem
  type) and hidden layers (tiered from top-tier to specialised)
- **NEAT-specific advice** on which functions work well with topology evolution
- **Intelligent Design integration** explaining the automated squash
  optimisation system and when to use it vs manual selection
- **Deprecated functions** (HYPOT, HYPOTv2, MEAN) with their replacements
- **Aliases** (CLIPPED, RELU, INVERSE, SINUSOID)
- Key terms (vanishing gradient, dead neuron) explained without assumed
  knowledge

Cross-referenced from README.md and AGENTS.md documentation layout.

## Evidence

This is a documentation-only change (new Markdown file plus cross-references).
No UI, performance, or behavioural changes. Verified output ranges against
actual squash implementations in `src/methods/activations/types/` and
`src/deprecated/`. Mutation probabilities verified against source code.

## Test Plan

- Documentation-only change; no functional code modified
- Quality checks (`./quality.sh --lint-only`) pass cleanly (formatting and
  linting)
- All existing tests remain unaffected
