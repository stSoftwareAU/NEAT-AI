/**
 * EvolveTeardown.ts - Run-level lifecycle teardown shared by the `evolve*`
 * entry points (Issue #3434).
 *
 * `evolveDir`, `evolveEnv`, and `evolveRL` share the same outer shape: they
 * track a champion clone across generations, restore it into the caller
 * creature at the end, then return. Before this module they leaked in two
 * ways:
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
import { clearDistanceCache } from "@breed/DistanceCache.ts";
import { clearWasmCompilationCache } from "@wasm/WasmCompilationCache.ts";
import { getSharedSubnetworkIndex } from "@discovery/SubnetworkHashIndex.ts";

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
 * The caller creature is member 0 of `neat.population` (see
 * `Neat.populatePopulation`), so it is skipped by identity. Population members
 * are independent of the caller creature — the champion is restored into the
 * caller via `loadFrom`, which rebuilds the caller's arrays — so disposing the
 * rest cannot invalidate it.
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
