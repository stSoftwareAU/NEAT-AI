# ⚙️ Configuration Troubleshooting

This document covers common invalid option combinations, decoding
`ValidationError` exceptions, and forward-only vs recurrent mode constraints.
See the index in [`../TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) for other
categories.

## ⚠️ Common invalid option combinations

### Feedback loop without disabling random samples

```
Error: "Feedback Loop, Disable Random Samples must be set together"
```

When enabling `feedbackLoop: true`, you must also set
`disableRandomSamples: true`:

```typescript
createNeatConfig({
  feedbackLoop: true,
  disableRandomSamples: true, // Required when feedbackLoop is true
});
```

### Adaptive mutation threshold ordering

```
Error: "Adaptive mutation large threshold must be greater than medium threshold"
```

The `large` threshold must exceed the `medium` threshold:

```typescript
createNeatConfig({
  adaptiveMutationThresholds: {
    medium: 6, // Must be less than large
    large: 12,
  },
});
```

### Plateau detection rate ordering

```
Error: "Plateau detection rapidImprovementRate must be greater than
minImprovementRate"
```

The `rapidImprovementRate` must exceed `minImprovementRate`:

```typescript
createNeatConfig({
  plateauDetection: {
    minImprovementRate: 0.001, // Must be less
    rapidImprovementRate: 0.02, // Must be greater
  },
});
```

## 💡 Understanding ValidationError messages

NEAT-AI uses typed `ValidationError` exceptions with a `name` property
indicating the category:

| Error Name               | Meaning                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| `NO_OUTWARD_CONNECTIONS` | A hidden or constant neuron has no outward connections                   |
| `NO_INWARD_CONNECTIONS`  | A hidden neuron has no inward connections                                |
| `IF_CONDITIONS`          | An IF neuron is missing required condition/positive/negative connections |
| `RECURSIVE_SYNAPSE`      | A backward connection in forward-only mode                               |
| `SELF_CONNECTION`        | A self-loop in forward-only mode                                         |
| `MEMETIC`                | Issues with memetic (learned weight) structures                          |
| `OTHER`                  | General validation errors                                                |

Example of catching and inspecting a validation error:

```typescript
try {
  creatureValidate(creature, { feedbackLoop: false });
} catch (error) {
  if (
    error instanceof ValidationError && error.reason === "RECURSIVE_SYNAPSE"
  ) {
    // Handle forward-only violation
  }
}
```

## 🔄 Forward-only vs recurrent mode constraints

**Forward-only** (default) rejects:

- **Self-connections** (neuron connected to itself). Checked when
  `forwardOnly: true` is passed to `creatureValidate()`.
- **Recursive synapses** (connection from a higher-indexed neuron to a
  lower-indexed one). Checked when `feedbackLoop: false`.

**Recurrent** mode (enabled with `feedbackLoop: true`) allows both self-loops
and backward connections, which is useful for time-series behaviours.

If you see unexpected `RECURSIVE_SYNAPSE` or `SELF_CONNECTION` errors, check
whether your creature topology matches the configured mode.

## See also

- [Configuration guide](../CONFIGURATION_GUIDE.md) — full topic index covering
  presets, evolution, training, discovery, mutation adaptation, regularisation,
  populations, workers, logging, and recipes.
- [API errors reference](../api/ERRORS.md) — programmatic error catalogue.
- [Training troubleshooting](TRAINING.md) — when invalid config manifests as
  divergence rather than a thrown `ValidationError`.
