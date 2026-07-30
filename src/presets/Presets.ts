/**
 * Configuration presets for common NEAT training scenarios (Issue #1619).
 *
 * Each preset is a `NeatOptions` object that can be spread into user
 * configuration. User overrides take precedence when spread after
 * the preset:
 *
 * ```ts
 * const config = createNeatConfig({
 *   ...QUICK_START_PRESET,
 *   populationSize: 25,  // overrides the preset value
 * });
 * ```
 *
 * Presets are designed to be composed — spread multiple presets or mix
 * with your own overrides to build the configuration you need.
 */

import type { NeatOptions } from "@config/NeatOptions.ts";

/**
 * Quick Start preset — small population, fast iterations, good for
 * learning and prototyping.
 *
 * **Use case:** Getting started with NEAT-AI, validating a problem
 * formulation, or rapid experimentation.
 *
 * **Trade-offs:** Smaller populations explore less of the solution space,
 * so this preset may not find globally optimal solutions. Discovery is
 * disabled for speed.
 *
 * **Settings rationale:**
 * - `populationSize: 10` — Small enough for fast generations
 * - `iterations: 100` — Enough to see progress without long waits
 * - `targetError: 0.1` — Relaxed target for quick convergence
 * - `trainPerGen: 1` — Single training pass per generation for speed
 * - `discoverySampleRate: -1` — Disable discovery to avoid Rust FFI overhead
 * - `timeoutMinutes: 5` — Hard stop after 5 minutes
 * - `elitism: 1` — Preserve the best creature each generation
 */
export const QUICK_START_PRESET: NeatOptions = {
  populationSize: 10,
  iterations: 100,
  targetError: 0.1,
  trainPerGen: 1,
  discoverySampleRate: -1,
  timeoutMinutes: 5,
  elitism: 1,
};

/**
 * Large Network preset — higher population, discovery enabled, suitable
 * for complex problems with many inputs/outputs.
 *
 * **Use case:** Problems requiring larger neural architectures, such as
 * image classification, multi-output regression, or complex control tasks.
 *
 * **Trade-offs:** Larger populations and discovery increase computation
 * time and memory usage significantly. Plateau detection helps escape
 * local optima but adds overhead.
 *
 * **Settings rationale:**
 * - `populationSize: 200` — Large population for better search coverage
 * - `iterations: 10_000` — Allow many generations for convergence
 * - `targetError: 0.01` — Tighter target for higher accuracy
 * - `trainPerGen: 2` — Extra training pass per generation for refinement
 * - `discoverySampleRate: 0.3` — Higher sample rate for structural analysis
 * - `discoveryRecordTimeOutMinutes: 10` — Longer recording window
 * - `discoveryAnalysisTimeoutMinutes: 20` — Longer analysis window
 * - `timeoutMinutes: 120` — Allow up to 2 hours
 * - `elitism: 2` — Preserve top 2 creatures per generation
 * - `plateauDetection.enabled: true` — Detect and respond to stagnation
 * - `plateauDetection.windowSize: 15` — Wider window for plateau detection
 * - `plateauDetection.responseMutationMultiplier: 2.5` — Aggressive response
 * - `stabilityAdaptation.enabled: true` — Adapt mutation to stability
 */
export const LARGE_NETWORK_PRESET: NeatOptions = {
  populationSize: 200,
  iterations: 10_000,
  targetError: 0.01,
  trainPerGen: 2,
  discoverySampleRate: 0.3,
  discoveryRecordTimeOutMinutes: 10,
  discoveryAnalysisTimeoutMinutes: 20,
  timeoutMinutes: 120,
  elitism: 2,
  plateauDetection: {
    enabled: true,
    windowSize: 15,
    responseMutationMultiplier: 2.5,
  },
  stabilityAdaptation: {
    enabled: true,
  },
};

/**
 * Memory Constrained preset — conservative resource usage, suitable for
 * limited-memory environments.
 *
 * **Use case:** Running on machines with limited RAM (e.g. small VMs,
 * CI/CD runners, or edge devices). Also useful when running multiple
 * training jobs concurrently.
 *
 * **Trade-offs:** Fewer threads and smaller populations limit parallelism
 * and search coverage. Discovery is disabled to avoid memory-intensive
 * Rust FFI operations.
 *
 * **Settings rationale:**
 * - `populationSize: 20` — Small population to reduce memory footprint
 * - `iterations: 500` — Moderate iteration count
 * - `targetError: 0.05` — Standard target error
 * - `threads: 2` — Limit parallel workers to conserve memory
 * - `discoverySampleRate: -1` — Disable discovery to save memory
 * - `trainingBatchSize: 50` — Smaller batches for lower peak memory
 * - `elitism: 1` — Minimal elitism
 * - `timeoutMinutes: 30` — Moderate timeout
 */
export const MEMORY_CONSTRAINED_PRESET: NeatOptions = {
  populationSize: 20,
  iterations: 500,
  targetError: 0.05,
  threads: 2,
  discoverySampleRate: -1,
  trainingBatchSize: 50,
  elitism: 1,
  timeoutMinutes: 30,
};

/**
 * Discovery Focused preset — aggressive structural evolution, longer
 * timeouts, suitable for finding novel architectures.
 *
 * **Use case:** Exploring new neural network topologies, research into
 * network architecture search, or problems where structure matters more
 * than weight tuning.
 *
 * **Trade-offs:** Longer timeouts and higher sample rates increase
 * computation time. The aggressive structural evolution may produce
 * larger, more complex networks.
 *
 * **Settings rationale:**
 * - `populationSize: 100` — Moderate population for structural diversity
 * - `iterations: 5_000` — Many generations for structural exploration
 * - `targetError: 0.03` — Tight target to push structural search further
 * - `discoverySampleRate: 0.5` — High sample rate for thorough analysis
 * - `discoveryRecordTimeOutMinutes: 15` — Extended recording window
 * - `discoveryAnalysisTimeoutMinutes: 30` — Extended analysis window
 * - `discoveryMaxNeurons: 12` — Analyse more neurons per iteration
 * - `timeoutMinutes: 180` — Allow up to 3 hours for thorough exploration
 * - `costOfGrowth: 0.000_000_01` — Lower growth penalty to encourage structure
 * - `plateauDetection.enabled: true` — Detect stagnation during search
 */
export const DISCOVERY_FOCUSED_PRESET: NeatOptions = {
  populationSize: 100,
  iterations: 5_000,
  targetError: 0.03,
  discoverySampleRate: 0.5,
  discoveryRecordTimeOutMinutes: 15,
  discoveryAnalysisTimeoutMinutes: 30,
  discoveryMaxNeurons: 12,
  timeoutMinutes: 180,
  costOfGrowth: 0.000_000_01,
  plateauDetection: {
    enabled: true,
  },
};

/**
 * Fast Convergence preset — bundles the high-impact "pace" levers that
 * ship fully implemented but OFF by default, so reaching `targetError`
 * takes fewer generations (Issue #2930).
 *
 * **Use case:** You want the library to converge as quickly as possible
 * on a supervised task and are happy to trade a little extra
 * per-generation compute (and a touch more premature-convergence risk)
 * for fewer generations overall. A one-line opt-in to "evolve faster".
 *
 * **Trade-offs:**
 * - **Higher per-generation cost.** `trainPerGen: 2` doubles the
 *   supervised training passes each generation, and adaptive population
 *   sizing can grow the population (up to 2× by default) when diversity
 *   drops — both buy faster convergence at the price of more work per
 *   generation.
 * - **Premature-convergence risk.** Higher elitism and an aggressive
 *   plateau response push hard toward exploitation. Plateau detection's
 *   2× mutation boost and per-species stagnation reclamation are the
 *   counter-weights that keep diversity flowing; if your task is highly
 *   multi-modal, consider widening `plateauDetection.windowSize` or
 *   lowering `elitism`.
 *
 * **Settings rationale:**
 * - `populationSize: 50` — Mid-sized base; adaptive sizing scales it.
 * - `iterations: 1_000` — Plenty of generations; convergence should
 *   arrive well before this cap.
 * - `targetError: 0.05` — Standard target so the gain is comparable to
 *   library defaults.
 * - **`trainPerGen` is deliberately left unset** so the supervised
 *   auto-scaling kicks in (`round(populationSize × 0.2)` per generation,
 *   Issue #2791). Pinning a small literal here would *starve* gradient
 *   descent below the default and slow convergence — the lever is the
 *   auto-scaling, not a hard-coded number.
 * - **`discoverySampleRate` is deliberately left unset** so it resolves to
 *   the default 20% (`DEFAULT_DISCOVERY_SAMPLE_RATE`). Discovery is *enabled*
 *   for this preset — unlike `QUICK_START_PRESET` and
 *   `MEMORY_CONSTRAINED_PRESET`, which set `discoverySampleRate: -1` to
 *   disable it. Structural discovery can help reach the target in fewer
 *   generations, which is exactly what this preset optimises for (Issue
 *   #3272).
 * - `elitism: 2` — Retain the top two performers so hard-won solutions
 *   are never lost to mutation.
 * - `timeoutMinutes: 30` — Sensible wall-clock guard.
 * - `plateauDetection.enabled: true` with
 *   `responseMutationMultiplier: 2.0` — On a stall, double the mutation
 *   rate to break out of local optima quickly (the "2× boost"). This is
 *   the lever that pays off on harder, plateau-prone tasks.
 * - `plateauDetection.windowSize: 10` — Detect stalls promptly.
 * - `adaptivePopulation.enabled: true` — Grow the population when
 *   diversity collapses and shrink it when the search is healthy, so
 *   compute is spent where it speeds convergence.
 * - `speciesStagnation` — Enabled (the default) with documented windows:
 *   `haltWindow: 12` halves a flat species' breeding share, and
 *   `extinctionWindow: 20` drops it entirely, reclaiming budget for
 *   species still making progress. Slightly tighter than the defaults
 *   (15/25) to recycle dead-end effort sooner.
 *
 * **When NOT to use this:** on trivially easy tasks (e.g. 2-input XOR)
 * the library defaults already converge in a handful of generations, and
 * the extra exploration here adds variance without paying off. The preset
 * earns its keep on harder, multi-modal problems where the defaults stall.
 */
export const FAST_CONVERGENCE_PRESET: NeatOptions = {
  populationSize: 50,
  iterations: 1_000,
  targetError: 0.05,
  elitism: 2,
  timeoutMinutes: 30,
  plateauDetection: {
    enabled: true,
    windowSize: 10,
    responseMutationMultiplier: 2.0,
  },
  adaptivePopulation: {
    enabled: true,
  },
  speciesStagnation: {
    enabled: true,
    haltWindow: 12,
    extinctionWindow: 20,
  },
};
