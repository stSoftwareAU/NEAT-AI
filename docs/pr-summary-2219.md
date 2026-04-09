## Summary

Extract named constants for magic numbers in `BackPropagation.ts`. All hardcoded
numeric values controlling training behaviour are now defined as descriptively
named module-scope constants, improving readability and making tuning easier.
This is a pure refactor with no behavioural change. Closes #2219.

## Constants extracted

| Constant                      | Value     | Purpose                                            |
| ----------------------------- | --------- | -------------------------------------------------- |
| `MAX_RANDOM_GENERATIONS`      | `10`      | Upper bound for random generation selection        |
| `DEFAULT_BIAS_LIMIT_SCALE`    | `10_000`  | Default limit scale for bias values                |
| `DEFAULT_WEIGHT_LIMIT_SCALE`  | `100_000` | Default limit scale for weight values              |
| `LEARNING_RATE_DECAY_FACTOR`  | `0.95`    | Default learning rate decay factor                 |
| `COORDINATION_FACTOR`         | `0.2`     | Default bias-weight coordination factor            |
| `ERROR_IMPROVEMENT_THRESHOLD` | `0.95`    | Error ratio below which improvement is significant |
| `ERROR_STAGNATION_THRESHOLD`  | `1.0`     | Error ratio below which stagnation is detected     |
| `IMPROVEMENT_BOOST_FACTOR`    | `1.1`     | Learning rate multiplier on improvement            |
| `STAGNATION_BOOST_FACTOR`     | `1.3`     | Learning rate multiplier on stagnation             |
| `MIN_ERROR_ADJUSTMENT`        | `0.5`     | Minimum adjustment factor when error worsens       |

## Evidence

All 44 existing BackPropagation tests pass unchanged, confirming no behavioural
change.

## Test Plan

- Added `test/propagate/BackPropagationConstants.ts` with 15 tests verifying:
  - Each constant has the correct documented value
  - Default config values use the named constants
  - Random generation stays within `MAX_RANDOM_GENERATIONS` bounds
