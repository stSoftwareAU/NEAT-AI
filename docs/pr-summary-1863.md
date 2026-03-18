## Summary

Extends hyperparameter self-adaptation by encoding learning rate, mutation
rates, weight perturbation scale, and regularisation strength as per-creature
evolvable parameters. Adds adaptive population sizing based on species diversity
metrics. Closes #1863.

### What was added

1. **Per-creature evolvable hyperparameters** — Each creature can carry its own
   `learningRate`, `addNeuronRate`, `addConnectionRate`,
   `weightPerturbationScale`, `l1RegularisationStrength`, and
   `l2RegularisationStrength`. These evolve alongside topology and weights so
   creatures with better-suited hyperparameters achieve higher fitness and
   propagate their settings.

2. **Gaussian mutation of hyperparameters** — During mutation, each
   hyperparameter is perturbed using a Gaussian distribution (Box-Muller
   transform) scaled by configurable `mutationStdDev`, then clamped within
   configured bounds.

3. **Weighted-blend crossover** — During breeding, offspring hyperparameters are
   computed as a random weighted blend (0.4–0.6) of both parents' values,
   preserving diversity while staying near the parental range.

4. **Adaptive population sizing** — New `AdaptivePopulationSizer` adjusts
   effective population size each generation based on species diversity:
   - Low diversity (converging too quickly) → grow population
   - High diversity + fitness plateau → shrink population
   - Normal range → maintain current size

5. **Full serialisation support** — Hyperparameters survive JSON export/import,
   `shallowClone()`, and creature transfer. Offspring inherit hyperparameters
   even when evolution is disabled if parents carry them.

### Configuration

All features are opt-in (disabled by default):

- `hyperparameterEvolution.enabled` — Enables per-creature hyperparameter
  evolution with configurable bounds for learning rate, weight perturbation, and
  regularisation strength.
- `adaptivePopulation.enabled` — Enables diversity-driven population sizing with
  configurable thresholds, adjustment rate, and min/max fractions.

### Files changed

- `src/config/HyperparameterConfig.ts` — New config types and defaults
- `src/config/AdaptivePopulationConfig.ts` — New config types and defaults
- `src/NEAT/HyperparameterEvolution.ts` — Mutation, crossover, diversity logic
- `src/NEAT/AdaptivePopulationSizer.ts` — Population size adjustment logic
- `src/architecture/CreatureInterfaces.ts` — Added `hyperparameters` field
- `src/Creature.ts` — Added `hyperparameters` property
- `src/utils/CreatureExportBuilder.ts` — Export hyperparameters
- `src/creature/CreatureSerialization.ts` — Import and clone hyperparameters
- `src/config/NeatArguments.ts` — New config fields
- `src/config/NeatOptions.ts` — New option types with CLI coercion
- `src/config/NeatConfigParsers.ts` — Parser functions for new configs
- `src/config/NeatConfig.ts` — Wire parsers into config creation
- `src/NEAT/Mutator.ts` — Apply hyperparameter mutation after topology mutation
- `src/architecture/Offspring.ts` — Crossover hyperparameters during breeding
- `src/breed/Breed.ts` — Pass config to Offspring.breed
- `src/breed/ParallelBreeding.ts` — Pass config to Offspring.breed
- `mod.ts` — Public API exports

### Tests added

- `test/config/HyperparameterConfig.ts` — Config defaults, overrides, CLI
  coercion
- `test/config/AdaptivePopulationConfig.ts` — Config defaults, overrides, CLI
  coercion
- `test/NEAT/HyperparameterEvolution.ts` — Mutation bounds, crossover blending,
  diversity
- `test/NEAT/HyperparameterSerialisation.ts` — Export/import, clone, breeding
  inheritance
- `test/NEAT/AdaptivePopulationSizer.ts` — Grow, shrink, stable, bounds, step
  size
