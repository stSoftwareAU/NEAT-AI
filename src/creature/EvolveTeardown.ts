/**
 * EvolveTeardown.ts - Run-level lifecycle teardown shared by the `evolve*`
 * entry points (Issue #3434).
 *
 * `evolveDir`, `evolveEnv`, and `evolveRL` share the same outer shape: they
 * track a champion clone across generations, restore it into the caller
 * creature at the end, then return. The caller's genome is snapshotted before
 * the population is built, and the snapshot is restored instead when the
 * champion is unusable (Issue #4061). The caller is validated at entry, so an
 * unusable caller is rejected before anything is touched (Issue #4078). Before
 * this module they leaked in two ways:
 *
 *  1. Each champion improvement overwrote `bestCreature` with a fresh
 *     `shallowClone()` and left the superseded clone's topology arrays and
 *     cached WASM activation reachable until the next GC.
 *  2. After the run, `neat.population` members and the final champion clone
 *     were never disposed, and the process-global breed/discovery caches
 *     (DistanceCache, WASM compilation cache, shared subnetwork index) were
 *     left populated — so a second `evolve*` call in the same process started
 *     from a dirty baseline and RSS crept up across repeated runs.
 *
 * Per-generation dropout dispose (#1568) already runs inside `NeatEvolution`;
 * these helpers are the missing run-level counterpart. Keeping them in one
 * module keeps the three entry points DRY and independently testable.
 */

import type { Creature } from "@creature";
import { ValidationError } from "@errors/ValidationError.ts";
import { clearDistanceCache } from "@breed/DistanceCache.ts";
import { clearWasmCompilationCache } from "@wasm/WasmCompilationCache.ts";
import { getSharedSubnetworkIndex } from "@discovery/SubnetworkHashIndex.ts";
import { getLogger } from "@utils/Logger.ts";

/**
 * Snapshot the caller creature before `neat.populatePopulation()` adopts it
 * (Issue #4061). `shallowClone()` builds fresh neuron/synapse arrays, so
 * disposing the caller during the run cannot empty the snapshot.
 *
 * @param creature The caller creature, before evolution starts.
 * @returns An independent copy of the caller's original genome.
 */
export function snapshotEvolveCaller(creature: Creature): Creature {
  return creature.shallowClone();
}

/**
 * Explain why a creature cannot be restored into a caller with the given
 * input/output counts, or return `undefined` when it can (Issue #4061).
 */
function unusableReason(
  candidate: Creature,
  input: number,
  output: number,
): string | undefined {
  const required = input + output;
  if (candidate.neurons.length < required) {
    return `neurons.length ${candidate.neurons.length} < input + output ${required}`;
  }
  try {
    candidate.validate();
  } catch (error) {
    return `validate() failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
  return undefined;
}

/**
 * Reject an unusable caller creature before any `evolve*` work starts
 * (Issue #4078). Called as the first statement of each entry point, before any
 * signal listener, worker or population exists, so an unusable caller is
 * rejected untouched rather than snapshotted, emptied or restored.
 *
 * @param creature The caller creature passed to the entry point.
 * @param label The entry point name, used as the error prefix (e.g. `evolveDir`).
 * @throws {ValidationError} The caller has fewer than `input + output` neurons
 *   or fails `validate()`. The message names the entry point and the reason.
 */
export function assertEvolveCallerUsable(
  creature: Creature,
  label: string,
): void {
  const reason = unusableReason(creature, creature.input, creature.output);
  if (reason !== undefined) {
    throw new ValidationError(
      `${label}: caller creature is unusable (${reason})`,
      "OTHER",
    );
  }
}

/**
 * Restore the run's champion into the caller, falling back to the caller's
 * original genome when the champion is unusable (Issue #4061).
 *
 * The champion is restored only if it has at least `input + output` neurons
 * and passes `validate()`. Otherwise the snapshot is restored, and when a
 * champion was supplied but rejected the fallback is logged. Throws if neither
 * is usable, leaving the caller untouched rather than emptied.
 *
 * Since the caller is validated at entry by {@link assertEvolveCallerUsable}
 * (Issue #4078), a valid caller always yields a usable snapshot. The throw is
 * therefore a backstop, reachable only if the snapshot is damaged after entry.
 *
 * @param caller The caller creature to restore into.
 * @param champion The run's champion clone, if one was adopted.
 * @param snapshot The caller's original genome from {@link snapshotEvolveCaller}.
 * @param debug Passed through to `loadFrom`.
 * @param label Context label for the log line and any thrown error.
 * @throws {ValidationError} Backstop only: the snapshot was damaged after entry
 *   and neither the champion nor the snapshot is usable.
 */
export function restoreEvolveChampion(
  caller: Creature,
  champion: Creature | undefined,
  snapshot: Creature,
  debug: boolean,
  label: string,
): void {
  const { input, output } = caller;
  if (champion) {
    const reason = unusableReason(champion, input, output);
    if (reason === undefined) {
      caller.loadFrom(champion, debug, label);
      return;
    }
    getLogger().warn(
      `${label}: champion not restorable (${reason}); restoring the caller's original genome`,
    );
  }
  const reason = unusableReason(snapshot, input, output);
  if (reason !== undefined) {
    throw new ValidationError(
      `${label}: neither the champion nor the caller's original genome is usable (snapshot: ${reason})`,
      "OTHER",
    );
  }
  caller.loadFrom(snapshot, debug, label);
}

/**
 * Adopt a new champion clone, disposing the one it replaces (Issue #3434).
 *
 * The evolve loop passes the current champion into `neat.evolve()` as a
 * read-only parent before this is called, and `neat.evolve()` clones (never
 * retains) that creature — so the superseded champion is safe to dispose here.
 * The returned clone is independent of both `previousBest` and `fittest`
 * (`shallowClone()` builds fresh neuron/synapse arrays), so disposing
 * `previousBest` first cannot corrupt the clone.
 *
 * @param previousBest The champion being replaced (`undefined` on first win).
 * @param fittest The generation's fittest creature to clone as the new champion.
 * @param score Score to stamp on the new champion clone.
 * @returns The fresh champion clone with `score` applied.
 */
export function adoptChampionClone(
  previousBest: Creature | undefined,
  fittest: Creature,
  score: number,
): Creature {
  previousBest?.dispose();
  const clone = fittest.shallowClone();
  clone.score = score;
  return clone;
}

/**
 * Dispose every population creature from a finished run except the caller's
 * creature, which the caller keeps using after `evolve*` returns (Issue #3434).
 *
 * The caller creature may be a member of `neat.population` (`Neat.populatePopulation`
 * adds it), so it is skipped by identity. The other members are independent of
 * the caller: the caller is restored from the champion or from its snapshot via
 * `loadFrom`, which rebuilds the caller's arrays, and the snapshot is a separate
 * `shallowClone()` (Issue #4061), so disposing these members cannot invalidate
 * either source.
 *
 * @param population The run's final population.
 * @param keep The caller creature to preserve.
 * @returns The number of population members disposed.
 */
export function disposeEvolvePopulation(
  population: readonly Creature[],
  keep: Creature,
): number {
  let disposed = 0;
  for (const member of population) {
    if (member === keep) continue;
    member.dispose();
    disposed++;
  }
  return disposed;
}

/**
 * Release the process-global breed/discovery caches at the end of an `evolve*`
 * run (Issue #3434): the DistanceCache, the WASM compilation cache, and the
 * shared subnetwork hash index.
 *
 * Safe to call only once a run has finished producing its final creature and
 * its worker pool has been terminated — every entry is a rebuildable cache, so
 * the restored caller creature simply recompiles its WASM template on next use.
 * Clearing them here ensures a second `evolve*` in the same process starts from
 * a clean baseline rather than inheriting the previous run's sticky templates
 * and breed/discovery indexes.
 */
export function releaseEvolveCaches(): void {
  clearDistanceCache();
  clearWasmCompilationCache();
  getSharedSubnetworkIndex().clear();
}
