## Summary

Add integration tests for Predictive Coding with complex, production-representative creatures. Closes #1914.

The existing PC tests only covered trivial problems (XOR with 3-4 hidden neurons). These new tests validate that PC training works correctly on creatures with 30+ hidden neurons, mixed activation functions, multiple layers of depth, and production-scale GRQ-cluster topologies (51+ hidden neurons).

## Evidence

All 8 new tests pass within the 120-second timeout (total: ~827ms):
- Complex creature with 36 hidden neurons across 4 layers with mixed activations (TANH, LOGISTIC, ReLU, IDENTITY, SELU, Swish)
- Production-representative GRQ-cluster topology with 51 hidden neurons across 5 layers with sparse connectivity and skip connections
- Forward-only creature with 32 hidden neurons using constructor-based layer creation
- Full quality gate passes with 4771 tests (0 failures)

## Test Plan

New test file: `test/predictiveCoding/ComplexCreatureIntegration.ts`

- **PC inference converges on complex creature with 36 hidden neurons** - verifies energy decreases during settling
- **PC inference populates trace fields on hidden neurons** - verifies prediction, predictionError, and latentValue fields are set
- **PC training produces non-zero weight gradients** - verifies at least some synapses are modified
- **PC training reduces error across iterations** - compares baseline vs trained error
- **trainDir with PC produces valid trace tags** - verifies approach, pc-energy, pc-inference-steps, pc-changed tags
- **PC training works on forward-only complex creature** - tests constructor-based multi-layer creature
- **PC training improves on production-representative GRQ-cluster topology** - 51+ hidden neurons, 6 inputs, 3 outputs
- **PC energy converges monotonically during inference** - verifies energy history decreases overall
