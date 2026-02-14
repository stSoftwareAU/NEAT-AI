## Summary

Reduce generational dampening in backpropagation that was slowing training
convergence. Closes #1436.

The `config.generations` parameter was creating excessive weight and bias
inertia by blending accumulated gradients with too many copies of the original
value. When generations was high (default random 1-100), the network was biased
towards its original weights/biases and slow to adapt.

### Changes

1. **Cap effective generations** in `Weight.ts` and `Bias.ts` to at most 2x the
   actual sample count. This ensures the gradient signal always has meaningful
   influence regardless of the configured generations value.

2. **Reduce default generations range** from 1-100 to 1-10 in
   `BackPropagation.ts`. This reduces the baseline dampening even before the cap
   takes effect.

3. **Update existing test** in `Generation.ts` to reflect the new expected
   weight value with reduced dampening (weight moves further toward gradient
   target).

## Evidence

This is a backend/algorithm change with no visual output. Evidence is provided
through unit tests that verify the reduced dampening behaviour:

- Tests confirm high generations (100) no longer overwhelms 10+ gradient samples
- Tests confirm the ratio of adjustment between low-gen and high-gen configs is
  bounded (high-gen achieves at least 25% of low-gen adjustment)
- All 3597 existing tests continue to pass

## Test Plan

- Added `test/propagate/GenerationalDampening.ts` with 8 new tests:
  - `calculateWeight - high generations does not overwhelm gradient signal`
  - `calculateWeight - dampening cap limits generational inertia`
  - `calculateWeight - generations=0 still works correctly`
  - `calculateBias - high generations does not overwhelm gradient signal`
  - `calculateBias - dampening cap limits generational inertia`
  - `calculateBias - generations=0 still works correctly`
  - `createBackPropagationConfig - default generations is capped at reasonable value`
  - `createBackPropagationConfig - explicit generations above cap is still respected`
- Updated `test/propagate/Generation.ts` expected weight value to reflect
  reduced dampening
