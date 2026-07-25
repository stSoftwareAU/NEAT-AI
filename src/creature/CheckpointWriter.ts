/**
 * CheckpointWriter.ts — bounded-batch checkpoint writing (Issue #3436).
 *
 * Extracted from `CreatureTraining.ts` so the checkpoint write path is a
 * small, focused, directly testable module.
 *
 * Issue #2275 made checkpoint writes async with compact JSON. That version
 * exported and stringified **every** population member up front and then
 * `Promise.all`-ed the writes, so peak heap grew as
 * `populationSize × genome JSON` on top of an already-hot generation —
 * painful with `checkpointEveryGeneration` and large adaptive populations
 * (Issue #3430).
 *
 * Issue #3436 caps that peak: creatures are exported, stringified, and
 * written in bounded batches, so at most `batchSize` genome JSON strings are
 * alive at once regardless of population size. File contents are unchanged.
 */

import { emptyDirSync } from "@std/fs";
import type { Creature } from "@creature";
import { CURRENT_CREATURE_SEMANTIC_VERSION } from "@creature";
import {
  assertValidWriteableSemanticVersion,
  isValidWriteableSemanticVersion,
} from "@upgrade/SemanticVersionValidation.ts";
import { applySeedWarmupTagsAtSave } from "@architecture/CreatureFactory.ts";

/**
 * Default number of checkpoint files exported, stringified, and written
 * concurrently. Small enough to bound peak heap, large enough to keep the
 * filesystem busy.
 */
export const DEFAULT_CHECKPOINT_WRITE_BATCH_SIZE = 8;

/** The population state a checkpoint write needs — satisfied by `Neat`. */
export interface CheckpointSource {
  readonly population: Creature[];
  readonly warmupGenerations: number;
  readonly currentGeneration: number;
}

/** Optional overrides; production callers pass none. */
export interface CheckpointWriteOptions {
  /**
   * Maximum genome JSON strings held (and writes in flight) at once.
   * Defaults to {@link DEFAULT_CHECKPOINT_WRITE_BATCH_SIZE}.
   */
  batchSize?: number;
  /** Test seam for the per-file write. Defaults to `Deno.writeTextFile`. */
  writeTextFile?: (path: string, text: string) => Promise<void>;
}

/**
 * Write every population member to `dir` as `1.json`, `2.json`, … in
 * bounded batches.
 *
 * The directory is emptied first, so the checkpoint always reflects exactly
 * the current population.
 *
 * @throws RangeError when `batchSize` is not a positive integer.
 */
export async function writeCreatures(
  source: CheckpointSource,
  dir: string,
  options: CheckpointWriteOptions = {},
): Promise<void> {
  const batchSize = options.batchSize ?? DEFAULT_CHECKPOINT_WRITE_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError(
      `batchSize must be a positive integer, got ${batchSize}`,
    );
  }
  const writeTextFile = options.writeTextFile ??
    ((path: string, text: string) => Deno.writeTextFile(path, text));

  emptyDirSync(dir);

  const population = source.population;
  for (let start = 0; start < population.length; start += batchSize) {
    const end = Math.min(start + batchSize, population.length);
    const batch: Promise<void>[] = [];
    for (let indx = start; indx < end; indx++) {
      const creature = population[indx];
      // Issue #2349: never write a creature without a valid semanticVersion.
      // If a creature somehow lost its version (empty, undefined, or pre-2.x),
      // heal it to the current default rather than writing an invalid value
      // that aborts downstream tools (GRQ worker).
      if (!isValidWriteableSemanticVersion(creature.semanticVersion)) {
        creature.semanticVersion = CURRENT_CREATURE_SEMANTIC_VERSION;
      }
      const json = creature.exportJSON();
      assertValidWriteableSemanticVersion(json.semanticVersion);
      // Issue #2909: stamp warm-up tags only at this export boundary. Stamp the
      // exported JSON (not the live population member) so the saved file is
      // correct regardless of which creature is saved: while warming it carries
      // the Neat-level counter, and once warm both tags are stripped.
      applySeedWarmupTagsAtSave(
        json,
        source.warmupGenerations,
        source.currentGeneration,
      );
      batch.push(
        writeTextFile(`${dir}/${indx + 1}.json`, JSON.stringify(json)),
      );
    }
    // Awaiting per batch is the point of Issue #3436: the batch's JSON
    // strings become garbage before the next batch allocates its own.
    // deno-lint-ignore no-await-in-loop
    await Promise.all(batch);
  }
}
