## Summary

Add behavioural tests for breeding and mutation operators to verify that core
evolutionary operators produce correct results. Closes #1441.

## Changes

### Breeding Tests (`test/breed/`)

- **BreedBehavioural.ts** (8 tests): Verifies offspring inherits structure from
  both parents, crossover produces valid creatures with preserved input/output
  dimensions, forward-only constraint is maintained, offspring can round-trip
  through JSON, and repeated crossover produces diverse offspring.

- **GeneticCompatibilityBehavioural.ts** (8 tests): Verifies genetic
  compatibility correctly measures distance — identical creatures yield 1.0,
  completely different creatures yield 0.0, partial overlap yields intermediate
  values, compatibility is symmetric, and the smaller set is used for ratio
  calculation.

### Mutation Tests (`test/mutate/`)

- **AddConnectionBehavioural.ts** (7 tests): Verifies AddConnection creates
  valid new connections with finite weights, respects forward-only constraint
  (no backward connections), returns false when fully connected, clears memetic
  flag, and supports weightScale option.

- **ModWeightBehavioural.ts** (7 tests): Verifies ModWeight changes weights
  within configured bounds (maxAbsoluteWeight, maxWeightChange), weights remain
  finite after mutation, creature remains valid, returns false with no synapses,
  and weight actually changes value.

- **ModSquashBehavioural.ts** (7 tests): Verifies ModSquash produces valid
  activation function assignments, creature remains valid after mutation, squash
  function actually changes, input neurons are never modified, diverse squash
  functions are assigned, and memetic flag is cleared.

- **SwapNeuronsBehavioural.ts** (8 tests): Verifies SwapNeurons maintains
  network validity, bias and squash are correctly swapped between neurons,
  returns false with insufficient hidden neurons, UUID remains stable after
  swap, creature can round-trip through JSON, and works with many hidden
  neurons.

## Evidence

This is a test-only change with no UI or performance impact. All 3273 tests
(including 45 new behavioural tests) pass via `./quality.sh`.

## Test Plan

- `test/breed/BreedBehavioural.ts` — 8 tests for Offspring crossover behaviour
- `test/breed/GeneticCompatibilityBehavioural.ts` — 8 tests for genetic distance
- `test/mutate/AddConnectionBehavioural.ts` — 7 tests for connection addition
- `test/mutate/ModWeightBehavioural.ts` — 7 tests for weight modification
- `test/mutate/ModSquashBehavioural.ts` — 7 tests for activation function
  mutation
- `test/mutate/SwapNeuronsBehavioural.ts` — 8 tests for neuron swapping
