## Summary

Add pre-built configuration presets for common NEAT training scenarios. With 50+
configuration keys in `NeatOptions`, new users face a steep learning curve.
These presets provide tested starting points for typical use cases. Closes #1619.

Four presets are defined and exported from the public API:

- **`QUICK_START_PRESET`** — Small population (10), fast iterations, discovery
  disabled. Good for learning and prototyping.
- **`LARGE_NETWORK_PRESET`** — Large population (200), discovery enabled at 30%,
  plateau detection, stability adaptation, and ensemble diversity enabled.
  Suitable for complex problems.
- **`MEMORY_CONSTRAINED_PRESET`** — Conservative resource usage (20 population,
  2 threads), discovery disabled. Suitable for limited-memory environments.
- **`DISCOVERY_FOCUSED_PRESET`** — Aggressive structural evolution (50% sample
  rate, 12 neurons analysed), longer timeouts (3 hours). Suitable for finding
  novel architectures.

Each preset is a `NeatOptions` object composable via spread syntax:

```ts
const config = createNeatConfig({
  ...QUICK_START_PRESET,
  populationSize: 25, // user override
});
```

## Evidence

This is a backend/configuration change with no UI component. All presets pass
through `createNeatConfig()` validation. Evidence is the test suite passing
(4287 tests, 0 failures).

## Test Plan

- Added `test/presets/Presets.ts` with 15 tests covering:
  - Each preset produces a valid configuration via `createNeatConfig()`
  - Key settings are applied correctly for each preset
  - User overrides take precedence over preset values
  - Presets can be composed via spread syntax
  - All presets satisfy the `NeatOptions` type
