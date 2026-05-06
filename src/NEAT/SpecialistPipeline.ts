/**
 * SpecialistPipeline.ts - Specialist sub-populations + ensemble distillation
 * orchestrator (Issue #2530).
 *
 * Mirrors DeepSeek V4's two-stage post-training pipeline at NEAT scale:
 *
 * 1. **Stage 1** — when the fitness function is multi-objective (M
 *    sub-tasks), seed M dedicated specialist species, each evolved
 *    against its own sub-task signal.
 * 2. **Stage 2** — periodically distil the specialists into a generalist
 *    creature via the On-Policy Distillation (OPD) breed operator
 *    (Issue #2528) and inject the result back into the main population.
 *
 * The pipeline is **disabled by default** (`mode = "off"`); a disabled
 * pipeline is a no-op for every public method.
 *
 * NEAT-AI already speciates by topology — this orchestrator adds an
 * orthogonal axis: speciation by *task*. The two are compatible and
 * compose: a topology-species can also be a task-specialist (the
 * `Genus.addCreatureWithTask` helper folds the task tag into the species
 * key so specialist species do not collide with same-topology
 * generalists).
 */

import type { Creature } from "@creature";
import type { Genus } from "@neat/Genus.ts";
import type { Species } from "@neat/Species.ts";
import {
  onPolicyDistillationBreed,
  type OpdBreedResult,
} from "@breed/OnPolicyDistillationBreed.ts";
import type { RequiredOpdConfig } from "@config/OpdConfig.ts";
import {
  DEFAULT_SPECIALIST_CONFIG,
  type RequiredSpecialistConfig,
} from "@config/SpecialistConfig.ts";
import { getLogger } from "@utils/Logger.ts";

/**
 * Multi-objective sub-score record.
 *
 * The pipeline interprets a "multi-objective" fitness function as one
 * that returns a `Record<string, number>` of named sub-scores per
 * creature, alongside (or instead of) a combined scalar fitness. This
 * shape avoids new identity surfaces — sub-scores are looked up by
 * sub-task id, never by creature integer index.
 */
export type SubTaskScores = Readonly<Record<string, number>>;

/**
 * Result of a single distillation step.
 *
 * `generalist === undefined` indicates the distillation could not run —
 * for example, because no specialist elites were available, or because
 * the OPD breed operator returned `undefined` (validation failure or
 * incompatible teacher topologies). Tests assert that, when present,
 * the generalist's combined sub-task score is no worse than the average
 * specialist's combined score.
 */
export interface DistillationResult {
  /** The freshly-distilled generalist creature, or undefined on failure. */
  generalist: Creature | undefined;
  /** The OPD breed result for telemetry, when distillation ran. */
  opdResult: OpdBreedResult | undefined;
  /** Number of specialist elites used as teachers. */
  teachersUsed: number;
}

/**
 * Specialist sub-population pipeline.
 *
 * Orchestrates the two-stage post-training pipeline:
 *
 * - {@link seedSpecialistSpecies} — Stage 1 seeding: tag a slice of
 *   creatures as specialists for a given sub-task, registering one
 *   species per declared sub-task in the supplied {@link Genus}.
 * - {@link routeFitness} — Per-generation routing: returns the score a
 *   specialist creature should be ranked by (its own sub-task's
 *   sub-score), or the combined fitness for generalists.
 * - {@link shouldDistill} — Cadence check: returns `true` when the
 *   current generation is a multiple of `distillEveryN`.
 * - {@link distillGeneralist} — Stage 2 distillation: runs OPD on the
 *   per-task elites to produce a single generalist offspring.
 *
 * The pipeline holds no mutable state of its own beyond the immutable
 * config; all population state lives in the supplied {@link Genus}.
 */
export class SpecialistPipeline {
  /** Effective configuration after defaults are applied. */
  readonly config: RequiredSpecialistConfig;

  /**
   * Construct a new pipeline. Config defaults are applied for any
   * missing fields. When `config.mode === "off"` (the default), every
   * public method becomes a no-op.
   */
  constructor(config: Partial<RequiredSpecialistConfig> = {}) {
    this.config = {
      ...DEFAULT_SPECIALIST_CONFIG,
      ...config,
    };
  }

  /** True iff the pipeline is enabled (mode !== "off") with at least one sub-task. */
  isEnabled(): boolean {
    return this.config.mode !== "off" && this.config.subTaskIds.length > 0;
  }

  /**
   * Detect whether a sub-score record represents a multi-objective
   * fitness function.
   *
   * A fitness function is multi-objective when the score record exposes
   * **two or more** finite sub-scores. Single-entry records are treated
   * as single-objective, which silently disables the pipeline (per the
   * issue's edge-case requirement).
   */
  static isMultiObjective(scores: SubTaskScores | undefined): boolean {
    if (!scores) return false;
    let count = 0;
    for (const key of Object.keys(scores)) {
      const v = scores[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        count++;
        if (count >= 2) return true;
      }
    }
    return false;
  }

  /**
   * Seed Stage 1 specialist species into the supplied {@link Genus}.
   *
   * Partitions `creatures` evenly across the declared `subTaskIds`,
   * tagging each slice with its sub-task id. Uses
   * {@link Genus.addCreatureWithTask} so the resulting species's
   * `specialistTaskId` is set and the species key is namespaced by the
   * sub-task tag.
   *
   * **Fallback**: if there are not enough creatures to give every
   * declared sub-task at least `minSpecialistsPerTask` members, the
   * pipeline silently falls back to standard speciation — every
   * creature is added without a task tag — and returns an empty array.
   * This satisfies the "fewer specialists than declared sub-tasks"
   * edge case from Issue #2530.
   *
   * @returns The list of seeded specialist {@link Species}, in the
   *   declared `subTaskIds` order. Empty when the pipeline is disabled
   *   or the fallback path was taken.
   */
  seedSpecialistSpecies(genus: Genus, creatures: Creature[]): Species[] {
    if (!this.isEnabled()) {
      // Disabled — fall through to standard speciation.
      for (const c of creatures) genus.addCreature(c);
      return [];
    }
    const ids = this.config.subTaskIds;
    const minPer = this.config.minSpecialistsPerTask;
    // Insufficient population — silently fall back to standard speciation.
    if (creatures.length < ids.length * minPer) {
      getLogger().info(
        `[specialist] insufficient population for ${ids.length} sub-tasks ` +
          `(${creatures.length} creatures, need >= ${ids.length * minPer}); ` +
          `falling back to standard speciation`,
      );
      for (const c of creatures) genus.addCreature(c);
      return [];
    }
    // Partition creatures evenly across sub-tasks. Remainder distributed
    // round-robin so no specialist starves when creatures.length doesn't
    // divide ids.length cleanly.
    const seeded: Species[] = [];
    const seenSpeciesPerTask = new Map<string, Species>();
    for (let i = 0; i < creatures.length; i++) {
      const taskId = ids[i % ids.length];
      const species = genus.addCreatureWithTask(creatures[i], taskId);
      if (!seenSpeciesPerTask.has(taskId)) {
        seenSpeciesPerTask.set(taskId, species);
      }
    }
    // Return in declared order so callers can correlate with subTaskIds.
    for (const id of ids) {
      const s = seenSpeciesPerTask.get(id);
      if (s) seeded.push(s);
    }
    return seeded;
  }

  /**
   * Per-generation fitness routing.
   *
   * A specialist creature (one whose species has a `specialistTaskId`)
   * is evaluated against **only** its assigned sub-task during fitness
   * ranking — its sub-score for that task is returned. A generalist
   * creature falls back to the combined `combinedFitness`.
   *
   * Returns `undefined` when no usable score is available (specialist
   * with missing sub-score, or generalist without a combined fitness).
   * Callers should treat `undefined` as "skip / cannot rank".
   */
  routeFitness(
    species: Species,
    scores: SubTaskScores | undefined,
    combinedFitness: number | undefined,
  ): number | undefined {
    const taskId = species.specialistTaskId;
    if (!this.isEnabled() || taskId === undefined) {
      // Generalist or pipeline disabled — use combined fitness.
      return Number.isFinite(combinedFitness) ? combinedFitness : undefined;
    }
    if (!scores) return undefined;
    const v = scores[taskId];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  }

  /**
   * True when the pipeline should run a distillation step on this
   * generation. Always false when the pipeline is disabled.
   */
  shouldDistill(generation: number): boolean {
    if (!this.isEnabled()) return false;
    if (!Number.isFinite(generation) || generation < 1) return false;
    return generation % this.config.distillEveryN === 0;
  }

  /**
   * Stage 2 distillation step: produce a generalist by running the OPD
   * breed operator with the per-sub-task elites as teachers.
   *
   * The caller selects one elite per sub-task (typically the best
   * specialist by its own sub-score) and passes them in here. The OPD
   * breed operator distils the consensus output of the elites into a
   * fresh student creature.
   *
   * Returns a result with `generalist === undefined` when distillation
   * could not run (no elites supplied, or OPD validation failure).
   */
  distillGeneralist(
    elites: Creature[],
    opdConfig: RequiredOpdConfig,
  ): DistillationResult {
    if (!this.isEnabled() || elites.length === 0) {
      return { generalist: undefined, opdResult: undefined, teachersUsed: 0 };
    }
    // OPD requires teachers to share input/output dimensions. Filter to
    // a consistent shape, preferring the most common shape in the elite
    // set so a single odd specialist does not block distillation.
    const consistentElites = filterConsistentShape(elites);
    if (consistentElites.length === 0) {
      return { generalist: undefined, opdResult: undefined, teachersUsed: 0 };
    }
    const result = onPolicyDistillationBreed(consistentElites, opdConfig);
    if (!result) {
      return {
        generalist: undefined,
        opdResult: undefined,
        teachersUsed: consistentElites.length,
      };
    }
    return {
      generalist: result.offspring,
      opdResult: result,
      teachersUsed: result.teachersUsed,
    };
  }
}

/**
 * Internal: filter `elites` to the largest subset that share the same
 * input/output dimensions. Ties broken in declaration order.
 */
function filterConsistentShape(elites: Creature[]): Creature[] {
  if (elites.length === 0) return [];
  const counts = new Map<string, number>();
  for (const c of elites) {
    const key = `${c.input}->${c.output}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bestKey = "";
  let bestCount = 0;
  for (const [k, n] of counts) {
    if (n > bestCount) {
      bestCount = n;
      bestKey = k;
    }
  }
  return elites.filter((c) => `${c.input}->${c.output}` === bestKey);
}
