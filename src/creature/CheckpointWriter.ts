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

/** True when `path` exists (any entry type); false only for ENOENT. */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** Remove `path` if present; a missing path is not an error. */
async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
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
 * Issue #4051 (PR #4051 review): `tempDir` and the swap-aside directory use
 * fixed names (`${dir}.tmp`, `${dir}.old`) rather than a fresh
 * `crypto.randomUUID()` per call, and every call first recovers any leftover
 * from a previous crash — a stale `tempDir` is discarded, and a stale
 * `oldDir` is either the only surviving copy (recovered when `dir` is
 * missing) or a completed swap's unswept sibling (discarded when `dir`
 * exists). A random-named temp dir was never revisited by a later call, so a
 * kill between `mkdir` and the final rename left an orphan next to the store
 * forever; a kill between the two swap renames left no checkpoint at all with
 * the only copy sitting under a name nothing reads.
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
  const tempDir = `${dir}.tmp`;
  const oldDir = `${dir}.old`;

  // Recover from a crash during a previous call before starting this one.
  await removeIfExists(tempDir);
  if (await exists(dir)) {
    // A completed swap whose final `oldDir` removal never ran — discard it.
    await removeIfExists(oldDir);
  } else {
    // Killed between the two swap renames below: `oldDir` is the only
    // surviving copy of the last-good checkpoint — put it back.
    try {
      await Deno.rename(oldDir, dir);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  await Deno.mkdir(tempDir, { recursive: true });

  let written = 0;
  let skipped = 0;
  // Declared outside the batch loop (Issue #4051 review) so the catch block
  // below can await writes already in flight for the batch that failed,
  // rather than racing the cleanup remove against them.
  let batch: Promise<void>[] = [];
  try {
    for (let start = 0; start < population.length; start += batchSize) {
      const end = Math.min(start + batchSize, population.length);
      batch = [];
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
    // The write failed partway through. Writes already pushed for the
    // failing batch are still in flight (Issue #4051 review): observe them
    // before removing `tempDir`, so the remove never races a write that is
    // still creating its file — Deno would otherwise exit on the write's
    // unhandled `NotFound` rejection, or the remove itself could fail with
    // "Directory not empty" and mask the original error.
    await Promise.allSettled(batch);
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch (cleanupError) {
      // The original export/write error is always the one rethrown; a
      // cleanup failure is logged, not swallowed, and left for the next
      // call's leftover-tempDir recovery above.
      getLogger().warn(
        `[CheckpointWriter] Failed to remove incomplete temp dir ${tempDir}: ` +
          `${cleanupError}`,
      );
    }
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

  // Swap: every member that will be written is already on disk in `tempDir`,
  // so replacing the previous checkpoint is now safe. `dir` is renamed aside
  // to `oldDir` rather than removed outright (Issue #4051 review), so a kill
  // between the two renames below leaves `oldDir` holding the last-good
  // state instead of leaving no checkpoint at all — the next call's
  // leftover recovery above puts it back.
  let hadPreviousDir = true;
  try {
    await Deno.rename(dir, oldDir);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      hadPreviousDir = false;
    } else {
      await Deno.remove(tempDir, { recursive: true });
      throw error;
    }
  }
  await Deno.rename(tempDir, dir);
  if (hadPreviousDir) {
    await removeIfExists(oldDir);
  }
}
