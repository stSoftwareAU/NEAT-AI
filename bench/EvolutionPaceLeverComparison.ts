/**
 * Issue #2931 — Benchmark OFF-by-default pace levers head-to-head.
 *
 * NEAT-AI ships many OFF-by-default "pace levers" (plateau detection,
 * adaptive population sizing, MCMC mutation acceptance, per-creature
 * hyperparameter evolution). Per-lever benches already exist, but each
 * tests one mechanism in isolation, so "which should we turn on?" has
 * only ever been answered by intuition.
 *
 * This harness runs the **same** fixed supervised problem under a matrix
 * of lever configurations and reports, for each:
 *
 *   - generations-to-`targetError` (convergence speed),
 *   - wall-clock milliseconds,
 *   - best error reached.
 *
 * Why this is a fair comparison (same spirit as
 * `bench/MCMCAdvantageConvergence.ts` and `bench/TrainPerGenConvergence.ts`):
 *
 *   - Every config starts from the *same* seeded initial population and
 *     the *same* fixed dataset.
 *   - The evolution loop is identical except for the lever(s) toggled on.
 *   - The run is fully deterministic: `generationsToTarget` and
 *     `bestError` are reproducible across runs (only wall-clock varies).
 *
 * Where a lever has a real production implementation, this harness calls
 * it directly so the comparison measures library behaviour rather than a
 * fabricated stand-in:
 *
 *   - `mcmc`                → `metropolisHastingsAccept` (@neat/MetropolisHastings.ts)
 *   - `adaptivePopulation`  → `computeAdaptivePopulationSize` (@neat/AdaptivePopulationSizer.ts)
 *   - `hyperparameterEvolution` → `createDefaultHyperparameters` /
 *                                 `mutateHyperparameters` (@neat/HyperparameterEvolution.ts)
 *
 * `plateauDetection` is modelled directly (window-based stall detection +
 * random-immigrant injection) because it has no single pure entrypoint.
 *
 * No production/runtime code is changed — this is pure measurement + docs.
 *
 * Run with:
 *   deno run --allow-read --allow-env --allow-ffi \
 *     bench/EvolutionPaceLeverComparison.ts
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { metropolisHastingsAccept } from "@neat/MetropolisHastings.ts";
import { computeAdaptivePopulationSize } from "@neat/AdaptivePopulationSizer.ts";
import { DEFAULT_ADAPTIVE_POPULATION_CONFIG } from "@config/AdaptivePopulationConfig.ts";
import {
  createDefaultHyperparameters,
  mutateHyperparameters,
} from "@neat/HyperparameterEvolution.ts";
import {
  DEFAULT_EVOLVABLE_HYPERPARAMETERS,
  DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG,
  type RequiredEvolvableHyperparameters,
} from "@config/HyperparameterConfig.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  type RandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";

// ---------------------------------------------------------------------------
// Lever configuration matrix
// ---------------------------------------------------------------------------

/** A single column in the comparison: which levers are switched on. */
export interface LeverConfig {
  /** Human-readable label for the comparison table. */
  readonly name: string;
  /** Inject random immigrants when best error stalls. */
  readonly plateauDetection: boolean;
  /** Grow/shrink the population from diversity + plateau signals. */
  readonly adaptivePopulation: boolean;
  /** Accept worsening offspring via Metropolis-Hastings. */
  readonly mcmc: boolean;
  /** Evolve per-creature learning rate + perturbation scale. */
  readonly hyperparameterEvolution: boolean;
}

/** Measured outcome for one lever configuration. */
export interface LeverResult {
  readonly name: string;
  /** Generations until `targetError` reached, or `null` if never reached. */
  readonly generationsToTarget: number | null;
  /** Wall-clock duration of the run in milliseconds. */
  readonly wallClockMs: number;
  /** Best (lowest) error reached during the run. */
  readonly bestError: number;
}

/** Tunable problem + run sizes (kept small so the bench stays quick). */
export interface ComparisonOptions {
  readonly inputs: number;
  readonly outputs: number;
  readonly hidden: number;
  readonly datasetSize: number;
  readonly population: number;
  readonly generations: number;
  readonly trainPerGen: number;
  readonly innerTrainIters: number;
  readonly targetError: number;
  readonly seed: number;
}

/** Production-scale defaults used when run as a standalone benchmark. */
export const DEFAULT_OPTIONS: ComparisonOptions = {
  inputs: 6,
  outputs: 3,
  hidden: 8,
  datasetSize: 48,
  population: 24,
  generations: 60,
  trainPerGen: 6,
  innerTrainIters: 4,
  targetError: 0.05,
  seed: 2931,
};

/** The six head-to-head configurations from issue #2931. */
export const LEVER_MATRIX: readonly LeverConfig[] = [
  {
    name: "baseline",
    plateauDetection: false,
    adaptivePopulation: false,
    mcmc: false,
    hyperparameterEvolution: false,
  },
  {
    name: "plateauDetection",
    plateauDetection: true,
    adaptivePopulation: false,
    mcmc: false,
    hyperparameterEvolution: false,
  },
  {
    name: "adaptivePopulation",
    plateauDetection: false,
    adaptivePopulation: true,
    mcmc: false,
    hyperparameterEvolution: false,
  },
  {
    name: "mcmc",
    plateauDetection: false,
    adaptivePopulation: false,
    mcmc: true,
    hyperparameterEvolution: false,
  },
  {
    name: "hyperparameterEvolution",
    plateauDetection: false,
    adaptivePopulation: false,
    mcmc: false,
    hyperparameterEvolution: true,
  },
  {
    name: "fast (combined)",
    plateauDetection: true,
    adaptivePopulation: false,
    mcmc: true,
    hyperparameterEvolution: true,
  },
];

// ---------------------------------------------------------------------------
// Fixed supervised problem (same construction as TrainPerGenConvergence)
// ---------------------------------------------------------------------------

interface Sample {
  readonly input: Float32Array;
  readonly target: Float32Array;
}

const BASE_LEARNING_RATE = 0.1;
const BASE_PERTURB_SCALE = 0.1;
/** Number of recent generations inspected for a plateau. */
const PLATEAU_WINDOW = 4;
/** Minimum best-error improvement over the window to count as progress. */
const PLATEAU_EPSILON = 1e-3;
/** Geometric cooling applied to the MCMC temperature each generation. */
const MCMC_COOLING = 0.9;
const MCMC_INITIAL_TEMPERATURE = 0.2;

function buildNetwork(
  rng: RandomNumberGenerator,
  opts: ComparisonOptions,
): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  const inputUUIDs = Array.from(
    { length: opts.inputs },
    (_, i) => `input-${i}`,
  );
  const hiddenUUIDs: string[] = [];
  for (let h = 0; h < opts.hidden; h++) {
    const uuid = `h-${h}`;
    hiddenUUIDs.push(uuid);
    neurons.push({
      type: "hidden",
      uuid,
      squash: "TANH",
      bias: (rng.random() * 2 - 1) * 0.1,
    });
  }
  const outputUUIDs: string[] = [];
  for (let o = 0; o < opts.outputs; o++) {
    const uuid = `output-${o}`;
    outputUUIDs.push(uuid);
    neurons.push({
      type: "output",
      uuid,
      squash: "LOGISTIC",
      bias: (rng.random() * 2 - 1) * 0.1,
    });
  }

  for (const from of inputUUIDs) {
    for (const to of hiddenUUIDs) {
      synapses.push({
        fromUUID: from,
        toUUID: to,
        weight: (rng.random() * 2 - 1) * 0.3,
      });
    }
  }
  for (const from of hiddenUUIDs) {
    for (const to of outputUUIDs) {
      synapses.push({
        fromUUID: from,
        toUUID: to,
        weight: (rng.random() * 2 - 1) * 0.3,
      });
    }
  }

  return {
    input: opts.inputs,
    output: opts.outputs,
    neurons,
    synapses,
  };
}

function buildDataset(
  rng: RandomNumberGenerator,
  opts: ComparisonOptions,
): Sample[] {
  const targetW: number[][] = Array.from(
    { length: opts.outputs },
    () => Array.from({ length: opts.inputs }, () => rng.random() * 2 - 1),
  );
  const logistic = (x: number) => 1 / (1 + Math.exp(-x));

  const samples: Sample[] = [];
  for (let s = 0; s < opts.datasetSize; s++) {
    const input = new Float32Array(opts.inputs);
    for (let i = 0; i < opts.inputs; i++) input[i] = rng.random() * 2 - 1;
    const target = new Float32Array(opts.outputs);
    for (let o = 0; o < opts.outputs; o++) {
      let sum = 0;
      for (let i = 0; i < opts.inputs; i++) sum += targetW[o][i] * input[i];
      target[o] = logistic(sum);
    }
    samples.push({ input, target });
  }
  return samples;
}

function meanError(
  creature: Creature,
  data: readonly Sample[],
  outputs: number,
): number {
  let total = 0;
  for (const { input, target } of data) {
    const out = creature.activate(input);
    for (let o = 0; o < outputs; o++) total += Math.abs(out[o] - target[o]);
  }
  return total / (data.length * outputs);
}

function trainCreature(
  creature: Creature,
  data: readonly Sample[],
  learningRate: number,
  innerIters: number,
): void {
  const json = creature.exportJSON();
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 1,
  });
  const sparse = new SparseConfig(json, config);
  for (let iter = 0; iter < innerIters; iter++) {
    for (const { input, target } of data) {
      creature.activateAndTrace(input, false, sparse);
      creature.propagate(target, config, sparse);
    }
  }
  creature.applyLearnings(config, sparse);
}

function perturb(
  source: Creature,
  rng: RandomNumberGenerator,
  scale: number,
): Creature {
  const json = source.exportJSON();
  for (const s of json.synapses) s.weight += (rng.random() * 2 - 1) * scale;
  for (const n of json.neurons) {
    if (typeof n.bias === "number") n.bias += (rng.random() * 2 - 1) * scale;
  }
  return Creature.fromJSON(json);
}

// ---------------------------------------------------------------------------
// One member of the evolving population
// ---------------------------------------------------------------------------

interface Member {
  creature: Creature;
  /** Per-creature hyperparameters (only evolved when the lever is on). */
  hyper: RequiredEvolvableHyperparameters;
  error: number;
}

/** Effective learning rate for a member given the active levers. */
function memberLearningRate(member: Member, config: LeverConfig): number {
  if (!config.hyperparameterEvolution) return BASE_LEARNING_RATE;
  // Scale the base rate by the evolved rate relative to its default so the
  // lever explores around the same operating point as every other config.
  const ratio = member.hyper.learningRate /
    DEFAULT_EVOLVABLE_HYPERPARAMETERS.learningRate;
  return BASE_LEARNING_RATE * ratio;
}

/** Effective weight-perturbation scale for a member given the active levers. */
function memberPerturbScale(member: Member, config: LeverConfig): number {
  if (!config.hyperparameterEvolution) return BASE_PERTURB_SCALE;
  const ratio = member.hyper.weightPerturbationScale /
    DEFAULT_EVOLVABLE_HYPERPARAMETERS.weightPerturbationScale;
  return BASE_PERTURB_SCALE * ratio;
}

/**
 * Estimate a species count from the population's error spread, used as the
 * diversity proxy fed to `computeAdaptivePopulationSize`. A wider spread of
 * errors implies more distinct behaviours (more "species").
 */
function estimateSpeciesCount(members: readonly Member[]): number {
  if (members.length === 0) return 1;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const m of members) {
    if (m.error < min) min = m.error;
    if (m.error > max) max = m.error;
  }
  const spread = max - min;
  // Map a 0..~0.3 error spread onto a 1..population species estimate.
  const fraction = Math.min(1, spread / 0.3);
  return Math.max(1, Math.round(1 + fraction * (members.length - 1)));
}

// ---------------------------------------------------------------------------
// Core evolution loop, parameterised by the active levers
// ---------------------------------------------------------------------------

/**
 * Runs one seeded evolution under `config` and returns the convergence
 * outcome. `initialPopulation` is shared (identical starting point) across
 * every config so the only variable is the lever(s) toggled on.
 */
export function runConfig(
  config: LeverConfig,
  initialPopulation: readonly CreatureExport[],
  dataset: readonly Sample[],
  opts: ComparisonOptions,
): LeverResult {
  // Seed the global RNG so the hyperparameter-evolution helpers (which read
  // the global generator) are deterministic. Restore the prior generator
  // afterwards so the harness leaves no global side effects.
  const priorRng = getRandomNumberGenerator();
  const seed = opts.seed + config.name.length * 1000 + 7;
  setRandomNumberGenerator(createSeededRng(seed));
  const rng = createSeededRng(seed ^ 0x5bd1e995);

  const start = performance.now();
  try {
    let members: Member[] = initialPopulation.map((j) => {
      const creature = Creature.fromJSON(structuredClone(j));
      const hyper = config.hyperparameterEvolution
        ? createDefaultHyperparameters(DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG)
        : { ...DEFAULT_EVOLVABLE_HYPERPARAMETERS };
      return {
        creature,
        hyper,
        error: meanError(creature, dataset, opts.outputs),
      };
    });

    let effectivePopulation = members.length;
    let temperature = MCMC_INITIAL_TEMPERATURE;
    let best = Number.POSITIVE_INFINITY;
    let generationsToTarget: number | null = null;
    const bestHistory: number[] = [];

    for (let gen = 0; gen < opts.generations; gen++) {
      // Evaluate + sort fittest-first.
      for (const m of members) {
        m.error = meanError(m.creature, dataset, opts.outputs);
      }
      members.sort((a, b) => a.error - b.error);
      best = Math.min(best, members[0].error);

      if (generationsToTarget === null && best <= opts.targetError) {
        generationsToTarget = gen;
        break;
      }

      // Plateau detection: no meaningful improvement across the window.
      bestHistory.push(members[0].error);
      let onPlateau = false;
      if (bestHistory.length >= PLATEAU_WINDOW) {
        const recent = bestHistory.slice(-PLATEAU_WINDOW);
        onPlateau = (recent[0] - recent[recent.length - 1]) < PLATEAU_EPSILON;
      }

      // Adaptive population sizing: grow/shrink from diversity + plateau.
      if (config.adaptivePopulation) {
        const speciesCount = estimateSpeciesCount(members);
        effectivePopulation = computeAdaptivePopulationSize(
          opts.population,
          effectivePopulation,
          speciesCount,
          onPlateau,
          { ...DEFAULT_ADAPTIVE_POPULATION_CONFIG, enabled: true },
        );
      }

      // Train the fittest `trainPerGen` members with real backprop.
      const trainCount = Math.min(opts.trainPerGen, members.length);
      for (let i = 0; i < trainCount; i++) {
        const m = members[i];
        trainCreature(
          m.creature,
          dataset,
          memberLearningRate(m, config),
          opts.innerTrainIters,
        );
        m.error = meanError(m.creature, dataset, opts.outputs);
      }
      members.sort((a, b) => a.error - b.error);

      // Breed the next generation.
      const targetSize = config.adaptivePopulation
        ? effectivePopulation
        : members.length;
      const keep = Math.max(1, Math.ceil(targetSize / 2));
      const topQuarter = Math.max(1, Math.floor(members.length / 4));
      const next: Member[] = members.slice(0, keep).map((m) => ({ ...m }));

      while (next.length < targetSize) {
        const parent = members[rng.randomInt(0, topQuarter - 1)];
        const childHyper = config.hyperparameterEvolution
          ? mutateHyperparameters(
            parent.hyper,
            DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG,
          )
          : parent.hyper;
        const childCreature = perturb(
          parent.creature,
          rng,
          memberPerturbScale({ ...parent, hyper: childHyper }, config),
        );
        const childError = meanError(childCreature, dataset, opts.outputs);

        let accept = true;
        if (config.mcmc) {
          // Accept worsening children with a cooling Metropolis-Hastings
          // probability; improving children are always kept.
          accept = metropolisHastingsAccept(
            childError - parent.error,
            temperature,
            rng.random(),
          );
        }

        if (accept) {
          next.push({
            creature: childCreature,
            hyper: childHyper,
            error: childError,
          });
        } else {
          // Rejected: carry a fresh perturbation of the parent instead so the
          // population size stays on target.
          next.push({ ...parent, hyper: childHyper });
        }
      }

      // Plateau escape: replace the weakest members with random immigrants.
      if (config.plateauDetection && onPlateau) {
        const immigrants = Math.max(1, Math.floor(next.length * 0.2));
        for (let i = 0; i < immigrants; i++) {
          const idx = next.length - 1 - i;
          if (idx <= 0) break;
          const fresh = Creature.fromJSON(buildNetwork(rng, opts));
          next[idx] = {
            creature: fresh,
            hyper: config.hyperparameterEvolution
              ? createDefaultHyperparameters(
                DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG,
              )
              : { ...DEFAULT_EVOLVABLE_HYPERPARAMETERS },
            error: meanError(fresh, dataset, opts.outputs),
          };
        }
        // Re-warm the temperature so MCMC can explore the fresh blood.
        temperature = Math.max(temperature, MCMC_INITIAL_TEMPERATURE * 0.5);
      }

      members = next;
      temperature *= MCMC_COOLING;
    }

    // Final sweep so a last-generation improvement is not missed.
    for (const m of members) {
      const e = meanError(m.creature, dataset, opts.outputs);
      best = Math.min(best, e);
    }
    if (generationsToTarget === null && best <= opts.targetError) {
      generationsToTarget = opts.generations;
    }

    return {
      name: config.name,
      generationsToTarget,
      wallClockMs: performance.now() - start,
      bestError: best,
    };
  } finally {
    setRandomNumberGenerator(priorRng);
  }
}

/**
 * Builds the shared problem and runs every config in `matrix`, returning one
 * `LeverResult` per config. Pure (no console output) so it is unit-testable.
 */
export function runLeverComparison(
  opts: ComparisonOptions = DEFAULT_OPTIONS,
  matrix: readonly LeverConfig[] = LEVER_MATRIX,
): LeverResult[] {
  const setupRng = createSeededRng(opts.seed);
  const dataset = buildDataset(setupRng, opts);
  const initialPopulation: CreatureExport[] = [];
  for (let p = 0; p < opts.population; p++) {
    initialPopulation.push(buildNetwork(setupRng, opts));
  }
  return matrix.map((config) =>
    runConfig(config, initialPopulation, dataset, opts)
  );
}

/** Renders the results as a GitHub-flavoured Markdown table. */
export function formatComparisonTable(results: readonly LeverResult[]): string {
  const header =
    "| config | generations-to-target | wall-clock ms | best error |";
  const divider =
    "| ------ | --------------------- | ------------- | ---------- |";
  const rows = results.map((r) => {
    const gens = r.generationsToTarget === null
      ? "—"
      : r.generationsToTarget.toString();
    return `| ${r.name} | ${gens} | ${r.wallClockMs.toFixed(1)} | ${
      r.bestError.toFixed(6)
    } |`;
  });
  return [header, divider, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Standalone benchmark entrypoint
// ---------------------------------------------------------------------------

if (import.meta.main) {
  console.log("Issue #2931 — Evolution pace lever comparison\n");
  console.log(
    `Population: ${DEFAULT_OPTIONS.population}, generations: ${DEFAULT_OPTIONS.generations}, ` +
      `dataset: ${DEFAULT_OPTIONS.datasetSize} samples, targetError: ${DEFAULT_OPTIONS.targetError}\n`,
  );

  const results = runLeverComparison();
  console.log(formatComparisonTable(results));

  const baseline = results.find((r) => r.name === "baseline");
  if (baseline) {
    console.log("\nConvergence vs baseline (fewer generations is better):");
    for (const r of results) {
      const gens = r.generationsToTarget;
      const base = baseline.generationsToTarget;
      const note = gens === null
        ? "did not reach target"
        : base === null
        ? `reached target in ${gens} generations`
        : `${gens} generations (${
          (((base - gens) / base) * 100).toFixed(1)
        }% vs baseline)`;
      console.log(`  ${r.name.padEnd(24)}: ${note}`);
    }
  }
}
