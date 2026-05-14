/**
 * EvolveRLStatistics.ts — Opt-in milestone statistics for `Creature.evolveRL()`
 * (Issue #2629, part of #2624).
 *
 * The statistics surface is intentionally narrow: a predicate that decides when
 * a generation is a "milestone" worth telemetry, and a typed payload describing
 * the snapshot at that milestone. Statistics are off by default; when the
 * caller passes `EvolveRLOptions.statistics === true`, `evolveRL()` collects
 * the payload at each milestone, emits an `evolverl_milestone` training event
 * via the existing `onTrainingEvent` emitter, and returns the per-milestone
 * array as part of the run summary.
 *
 * Milestone schedule: `1, 2, 5, 10, 20, 50, 100, 200, 500, 1000`. Beyond 1000
 * the schedule sparsifies geometrically — only powers of ten (`10_000`,
 * `100_000`, …) qualify. This keeps the emit cadence roughly constant per
 * decade of training without flooding callers in long runs.
 *
 * Issue #2647: when a run terminates between two scheduled milestones (e.g.
 * `targetError` met at generation 47, or `iterations = 7`), `evolveRL()`
 * appends a synthetic final-generation milestone using the same payload shape
 * so `result.milestones[result.milestones.length - 1].generation` always
 * equals `result.generation`. Chart-builders and resume helpers can therefore
 * trust the rightmost milestone to track the actual termination generation.
 */

/**
 * Per-milestone snapshot emitted on the `evolverl_milestone` lifecycle event
 * and accumulated into the `evolveRL()` return value when statistics are
 * enabled.
 *
 * Field semantics:
 *
 * - `generation` — 1-based generation counter that just completed.
 * - `bestScore` — best creature's mean return across the per-generation seed
 *   set. This is the raw RL return, not the NEAT score (which folds in a
 *   growth penalty via {@link calculateScore}).
 * - `bestNeurons` — total neuron count (input + hidden + output) of the
 *   fittest creature in this generation. Mirrors `creature.neurons.length`.
 * - `bestSynapses` — synapse count of the fittest creature in this generation.
 *   Mirrors `creature.synapses.length`.
 * - `meanEpisodeSteps` — mean number of `step()` calls across every episode
 *   played in this generation (population × episodesPerCreature).
 * - `generationWallClockMs` — wall-clock duration of the generation in
 *   milliseconds, measured from the start of the generation to the moment the
 *   milestone payload is built.
 */
export interface EvolveRLMilestone {
  readonly generation: number;
  readonly bestScore: number;
  readonly bestNeurons: number;
  readonly bestSynapses: number;
  readonly meanEpisodeSteps: number;
  readonly generationWallClockMs: number;
}

/**
 * Predicate: should generation `g` emit a milestone payload?
 *
 * Returns `true` for `g ∈ {1, 2, 5, 10, 20, 50, 100, 200, 500, 1000}` and for
 * pure powers of ten beyond `1000` (`10_000`, `100_000`, …). Returns `false`
 * for non-positive integers, non-integer values, and any other generation.
 *
 * Implementation note: rather than enumerating the schedule into a `Set`, the
 * function reduces `g` by repeated division by ten and inspects the residue.
 * For `g ≤ 1000` the residue must be `1`, `2`, or `5`. For `g > 1000` the
 * residue must be `1` (i.e. `g` is a power of ten). This keeps the predicate
 * O(log₁₀ g) and free of allocation on the hot path.
 */
export function isMilestoneGeneration(g: number): boolean {
  if (!Number.isInteger(g) || g < 1) return false;

  // Strip trailing zeros: divide by 10 while the value is divisible by 10 and
  // greater than the smallest milestone digit (1).
  let v = g;
  while (v >= 10 && v % 10 === 0) v = v / 10;

  if (g <= 1000) {
    return v === 1 || v === 2 || v === 5;
  }
  // Beyond 1000 the schedule keeps only powers of ten so the cadence is one
  // milestone per decade. 2_000 / 5_000 / 20_000 etc. are deliberately
  // excluded.
  return v === 1;
}
