# 📝 Logging and reproducibility

These options control where NEAT-AI (NeuroEvolution of Augmenting Topologies —
Artificial Intelligence) routes its log output, how often it logs, and how to
make a run deterministic for reproducibility experiments.

```ts
import { createNeatConfig } from "@anthropic/neat-ai";

const config = createNeatConfig({
  log: 1,
  logLevel: "info",
  seed: 42,
  // Fix non-deterministic defaults to make runs reproducible:
  sparseRatio: 0.5,
  globalBreedingRate: 0.5,
});
```

## 📊 Quick reference

| Option     | Type                    | Default                            | Description                                                   |
| ---------- | ----------------------- | ---------------------------------- | ------------------------------------------------------------- |
| `log`      | `integer`               | `0` (`1` when verbose is true)     | Output training status every N iterations (min: 0)            |
| `logLevel` | `LogLevel`              | `"info"`                           | Log level filter for the default console logger               |
| `logger`   | `Logger`                | console logger at `"info"` level   | Custom logger instance for routing log output                 |
| `seed`     | `number`                | `undefined` (uses `Math.random()`) | Seed for reproducible random number generation                |
| `rng`      | `RandomNumberGenerator` | `undefined`                        | Custom Random Number Generator (takes precedence over `seed`) |

## 🔊 Log cadence and routing

### `log`

**Default: 0 (1 when verbose is true)** | Type: integer | Min: 0

Output training status every N iterations. Set to `1` to log every iteration,
`0` to disable periodic logging.

### `logLevel`

**Default: "info"** | Type: LogLevel

Log level filter for the default console logger. Ignored when a custom `logger`
is provided.

### `logger`

**Default: console logger at "info" level** | Type: Logger

Custom logger instance for routing NEAT-AI log output to external logging
systems.

## 🎲 Reproducibility

### `seed`

**Default: undefined (uses Math.random())** | Type: number

Seed for reproducible random number generation. When provided, all stochastic
operations (mutation, selection, breeding, shuffling) use a deterministic
xoshiro256** PRNG (Pseudo-Random Number Generator). Two runs with the same seed
and configuration produce identical results.

> [!TIP]
> Always set `seed`, `sparseRatio`, and `globalBreedingRate` to fixed values
> when running reproducibility experiments. Both `sparseRatio` and
> `globalBreedingRate` default to random values, which produce different results
> between runs even when a `seed` is provided if these are left as defaults.

### `rng`

**Default: undefined** | Type: RandomNumberGenerator

Custom Random Number Generator instance. Takes precedence over `seed` when both
are provided.

## ✅ Validation rules

`createNeatConfig()` validates all parameters and throws on invalid
configurations. The cross-cutting rules below apply across the configuration
surface:

1. **feedbackLoop + disableRandomSamples:** When `feedbackLoop` is `true`,
   `disableRandomSamples` must also be `true`.
2. **Adaptive mutation thresholds:** `large` must be greater than `medium`.
3. **Plateau detection:** `rapidImprovementRate` must be greater than
   `minImprovementRate`.
4. **Quantum step:** `maxStep` must be greater than or equal to `minStep`.
5. **Fine-tune population:**
   - `maxPopulationFraction >= minPopulationFraction`
   - `basePopulationFraction >= minPopulationFraction`
   - `basePopulationFraction <= maxPopulationFraction`
6. **Discovery focus neuron UUIDs:** Must be an array of non-empty strings.
7. **Range constraints:** Many numeric options have minimum/maximum bounds
   enforced by `parseNumber()`. See the topic detail docs for specific ranges.

## 👀 See also

- [Core evolution parameters](./CORE_EVOLUTION.md) — `verbose` and `debug`
  toggles flow through to the default logger.
- [Recipes](./RECIPES.md) — research/reproducibility recipe.
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) — common logging and
  reproducibility pitfalls.
- [PERFORMANCE_TUNING.md](../PERFORMANCE_TUNING.md) — log cadence and
  per-iteration overhead.

---

**Up to:** [`README.md`](../../README.md) (entry point) ·
[`docs/README.md`](../README.md) (topic index).
