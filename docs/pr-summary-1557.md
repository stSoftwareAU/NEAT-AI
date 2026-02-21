## Summary

Use Predictive Coding prediction errors to guide NEAT structural mutations. When
PC inference has been run, neurons and synapses with high prediction errors are
preferentially selected for structural mutation (neuron addition, connection
addition), concentrating evolutionary search on regions where the network's
internal model is poorest. When PC is disabled, mutation operates exactly as
before with uniform random selection. Closes #1557.

### What Changed

- **New file `src/predictiveCoding/PredictionErrorGuidedMutation.ts`**: Computes
  `MutationBias` from per-neuron prediction errors stored in creature state.
  Provides `selectWeightedIndex()` for weighted random selection and
  `neuronBiasToIndexWeights()` for converting UUID-keyed bias to index-keyed
  weights.
- **`src/mutate/RadioactiveInterface.ts`**: Extended `mutate()` signature to
  accept optional `MutationBias`.
- **`src/mutate/AbstractMutationOperator.ts`**: Passes `MutationBias` through to
  `performMutation()`.
- **`src/mutate/AddNeuron.ts`**: Source and target neuron selection now uses
  weighted selection when bias is provided, concentrating neuron insertion near
  high-error regions.
- **`src/mutate/AddConnection.ts`**: Connection pair selection now uses weighted
  selection when bias is provided, preferring pairs involving high-error
  neurons.
- **`src/NEAT/Mutator.ts`**: Computes `MutationBias` from creature state when PC
  is enabled and passes it through to mutation operators.

### Design Decisions

- **Non-invasive integration**: The bias is optional throughout — all existing
  mutation operators continue to work exactly as before when no bias is
  provided.
- **Error magnitude weighting**: Absolute prediction error is used as raw
  weight, normalised to sum to 1.0. For synapses, the maximum error of the two
  connected neurons is used.
- **Uniform fallback**: When all errors are zero or equal, weights are uniform
  (matching random baseline).

## Evidence

This is a backend/algorithmic change with no UI. Evidence is provided by the
test suite:

- 10 unit tests verify bias computation, normalisation, and weighted selection
- 6 integration tests verify end-to-end pipeline from prediction errors through
  mutation operators
- All 4332 existing tests pass unchanged

## Test Plan

- `test/predictiveCoding/PredictionErrorGuidedMutation.ts` (10 tests):
  - Bias concentrates on high-error neurons
  - Uniform errors produce uniform weights
  - Bias weights are properly normalised
  - Returns undefined when no prediction errors exist
  - Negative errors use absolute value
  - Synapse weights reflect connected neuron errors
  - `selectWeightedIndex` respects weights
  - `selectWeightedIndex` with uniform weights acts like random
  - `selectWeightedIndex` falls back to uniform when no weights match
  - All-zero errors produce uniform weights
- `test/predictiveCoding/PredictionErrorGuidedMutationIntegration.ts` (6 tests):
  - `computeMutationBias` from real prediction errors
  - `neuronBiasToIndexWeights` creates correct index mapping
  - `AddNeuron` accepts mutation bias without errors
  - `AddConnection` accepts mutation bias without errors
  - Mutation without bias is unchanged behaviour
  - `selectWeightedIndex` distributes according to error magnitude
