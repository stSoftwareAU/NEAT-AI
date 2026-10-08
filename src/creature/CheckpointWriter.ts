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

import type { Creature } from "@creature";
import { CURRENT_CREATURE_SEMANTIC_VERSION } from "@creature";
import {
  assertValidWriteableSemanticVersion,
  isValidWriteableSemanticVersion,
} from "@upgrade/SemanticVersionValidation.ts";
import { applySeedWarmupTagsAtSave } from "@architecture/CreatureFactory.ts";
import { getLogger } from "@utils/Logger.ts";

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
 * True when `creature` has been disposed (`Creature.dispose()`): every live
 * creature has at least `input` neurons, so `dispose()` zeroing both
 * `neurons` and `synapses` is the only way `neurons.length` can fall below
 * `input`. This is checked explicitly — rather than catching the `RangeError`
 * `CreatureExportBuilder.build()` throws for a disposed creature
 * (`new Array(neuronsLength - input)` with a negative length) — so a genuine
 * export bug on a real creature is never misreported as disposal (Issue
 * #4050 review).
 */
function isDisposedCreature(creature: Creature): boolean {
  return creature.neurons.length < creature.input;
}

/**
 * Write every population member to `dir` as `1.json`, `2.json`, … in
 * bounded batches.
 *
 * Issue #4050: the whole write lands in a sibling temp directory first and is
 * only swapped into `dir` once every member has been exported and written
 * without error. The previous behaviour emptied `dir` up front, so a failure
 * partway through — or a creature disposed mid-write by a racing abandoned
 * generation — left the checkpoint with gaps instead of the last-good state.
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

  const population = source.population;
  const tempDir = `${dir}.tmp-${crypto.randomUUID()}`;
  await Deno.mkdir(tempDir, { recursive: true });

  let written = 0;
  let skipped = 0;
  try {
    for (let start = 0; start < population.length; start += batchSize) {
      const end = Math.min(start + batchSize, population.length);
      const batch: Promise<void>[] = [];
      for (let indx = start; indx < end; indx++) {
        const creature = population[indx];
        // Issue #4050: skip (and name) a creature disposed mid-write by a
        // racing abandoned generation, rather than letting the export throw.
        if (isDisposedCreature(creature)) {
          skipped++;
          getLogger().warn(
            `[CheckpointWriter] Skipping disposed creature ${creature.uuid} ` +
              `(neurons.length=${creature.neurons.length} < input=${creature.input}) ` +
              `— Issue #4050`,
          );
          continue;
        }
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
        written++;
        batch.push(
          writeTextFile(`${tempDir}/${indx + 1}.json`, JSON.stringify(json)),
        );
      }
      // Awaiting per batch is the point of Issue #3436: the batch's JSON
      // strings become garbage before the next batch allocates its own.
      // deno-lint-ignore no-await-in-loop
      await Promise.all(batch);
    }
  } catch (error) {
    // The write failed partway through: discard the incomplete temp dir and
    // leave the last-good checkpoint at `dir` untouched.
    await Deno.remove(tempDir, { recursive: true });
    throw error;
  }

  // Issue #4050: a non-empty population that produced zero written members
  // is every member disposed — writing that as "the checkpoint" would
  // silently replace the last-good state with an empty one. Fail loud and
  // leave `dir` untouched instead.
  if (population.length > 0 && written === 0) {
    await Deno.remove(tempDir, { recursive: true });
    throw new Error(
      `[CheckpointWriter] All ${population.length} population member(s) were ` +
        `disposed — refusing to replace the checkpoint at ${dir} with an ` +
        `empty one (Issue #4050)`,
    );
  }
  if (skipped > 0) {
    getLogger().warn(
      `[CheckpointWriter] Skipped ${skipped} of ${population.length} ` +
        `disposed creature(s); wrote ${written}`,
    );
  }

  // Atomic swap: every member that will be written is already on disk in
  // `tempDir`, so replacing the previous checkpoint is now safe.
  try {
    await Deno.remove(dir, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      await Deno.remove(tempDir, { recursive: true });
      throw error;
    }
  }
  await Deno.rename(tempDir, dir);
}
