/**
 * RandomImmigrants.ts - Inject fresh genomes on a detected plateau
 * (Issue #2933).
 *
 * When evolution stalls, the fastest way to resume progress is often to
 * inject **fresh** genetic material rather than perturb the existing
 * genomes. This module provides a small, isolated controller that — driven
 * by the existing {@link PlateauDetector} signal — replaces the weakest
 * non-elite creatures with freshly seeded genomes while always preserving
 * the elites.
 *
 * The controller is split into two concerns so each is independently
 * testable:
 *
 * - {@link RandomImmigrants} owns the *decision* logic: when on a plateau
 *   long enough, and outside the cooldown window, it signals an injection
 *   and reports how many immigrants to create.
 * - {@link injectRandomImmigrants} performs the *mechanical* replacement on
 *   a population array, preserving elites and replacing the weakest
 *   non-elite creatures with genomes produced by a caller-supplied factory.
 *
 * OFF by default — see {@link RandomImmigrantsConfig}.
 */

import type { Creature } from "@creature";
import type { RequiredRandomImmigrantsConfig } from "@config/RandomImmigrantsConfig.ts";

/**
 * Outcome of an immigrant-injection pass.
 */
export interface ImmigrantInjectionResult {
  /** Number of non-elite creatures replaced with fresh genomes. */
  injected: number;
  /** UUIDs of the creatures that were replaced (for logging / telemetry). */
  replacedUuids: string[];
}

/**
 * Decides when to inject random immigrants and how many to create, based on
 * the existing plateau signal plus a trigger window and cooldown.
 *
 * The detector is stateful only in that it remembers the generation of the
 * last injection so it can enforce the cooldown. All decisions are pure
 * functions of the supplied arguments and that single recorded value.
 *
 * @example
 * ```ts
 * const controller = new RandomImmigrants(config);
 * if (controller.shouldInject(generationsOnPlateau, currentGeneration)) {
 *   const count = controller.immigrantCount(populationSize, eliteCount);
 *   injectRandomImmigrants(population, eliteCount, count, makeImmigrant);
 *   controller.recordInjection(currentGeneration);
 * }
 * ```
 */
export class RandomImmigrants {
  private readonly config: RequiredRandomImmigrantsConfig;
  private lastInjectionGeneration: number | null = null;

  /**
   * Creates a new controller with the given configuration.
   *
   * @param config - Random-immigrants configuration (all fields required)
   */
  constructor(config: RequiredRandomImmigrantsConfig) {
    this.config = config;
  }

  /**
   * Decides whether immigrants should be injected this generation.
   *
   * Returns `true` only when:
   * - injection is `enabled`, and
   * - the population has been on a plateau for at least `triggerWindow`
   *   generations, and
   * - the configured `cooldown` has elapsed since the last injection.
   *
   * @param generationsOnPlateau - Consecutive generations on a plateau
   *   (from {@link PlateauDetector.getGenerationsOnPlateau}).
   * @param currentGeneration - The current generation number.
   * @returns `true` if immigrants should be injected this generation.
   */
  shouldInject(
    generationsOnPlateau: number,
    currentGeneration: number,
  ): boolean {
    if (!this.config.enabled) {
      return false;
    }
    if (generationsOnPlateau < this.config.triggerWindow) {
      return false;
    }
    if (this.lastInjectionGeneration !== null) {
      const sinceLast = currentGeneration - this.lastInjectionGeneration;
      if (sinceLast < this.config.cooldown) {
        return false;
      }
    }
    return true;
  }

  /**
   * Computes how many immigrants to inject for a given population.
   *
   * The count is `floor(injectionFraction * nonEliteCount)`, where
   * `nonEliteCount = max(0, populationSize - eliteCount)`. When the
   * fraction rounds down to zero but at least one non-elite slot exists and
   * injection is enabled, a single immigrant is injected so an enabled
   * controller always makes progress on a plateau.
   *
   * @param populationSize - Total population size.
   * @param eliteCount - Number of elites that must be preserved.
   * @returns The number of immigrants to inject (>= 0).
   */
  immigrantCount(populationSize: number, eliteCount: number): number {
    if (!this.config.enabled) {
      return 0;
    }
    const nonElite = Math.max(0, populationSize - eliteCount);
    if (nonElite === 0) {
      return 0;
    }
    const count = Math.floor(nonElite * this.config.injectionFraction);
    return Math.max(1, count);
  }

  /**
   * Records that an injection happened at the given generation, starting the
   * cooldown window.
   *
   * @param currentGeneration - The generation in which immigrants were
   *   injected.
   */
  recordInjection(currentGeneration: number): void {
    this.lastInjectionGeneration = currentGeneration;
  }

  /**
   * Resets the controller's cooldown state. Call when starting a new
   * evolution run.
   */
  reset(): void {
    this.lastInjectionGeneration = null;
  }
}

/**
 * Replaces the weakest non-elite creatures in a population with fresh
 * genomes, preserving the elites.
 *
 * The first `eliteCount` entries of `population` are treated as elites and
 * are never touched. The remaining creatures are ranked by score (ascending
 * — worst first); creatures without a numeric score are treated as the
 * weakest so freshly bred, not-yet-evaluated offspring are replaced before
 * any scored survivor. The weakest `count` of them are replaced in place by
 * genomes from `makeImmigrant`.
 *
 * The replaced victims are dropped from `population` but are NOT disposed:
 * the same creature objects are frequently still referenced by the breeding
 * genus (elites and trained survivors are shared between the population and
 * the parent pool), and `Creature.dispose()` empties `neurons`/`synapses`
 * while leaving `input` non-zero. Disposing a shared victim here left a
 * corrupt genome in the genus that later crashed `shallowClone` mid-breed
 * (`Cannot read properties of undefined (reading 'id')`), aborting the whole
 * evolve run. Ownership is shared, so this helper must not free them; the
 * WASM activation LRU cache bounds their memory and GC reclaims the rest.
 *
 * The population array is mutated in place and its length is preserved.
 *
 * @param population - The population array (elites first). Mutated in place.
 * @param eliteCount - Number of leading elites to preserve.
 * @param count - Number of immigrants to inject.
 * @param makeImmigrant - Factory producing a fresh genome per call.
 * @returns The number injected and the UUIDs of the replaced creatures.
 */
export function injectRandomImmigrants(
  population: Creature[],
  eliteCount: number,
  count: number,
  makeImmigrant: () => Creature,
): ImmigrantInjectionResult {
  const safeElite = Math.max(0, Math.min(eliteCount, population.length));
  const rest = population.slice(safeElite);
  const replaceCount = Math.max(0, Math.min(count, rest.length));
  if (replaceCount === 0) {
    return { injected: 0, replacedUuids: [] };
  }

  // Rank non-elites worst-first. Unscored creatures (freshly bred offspring)
  // sort as the weakest so they are replaced ahead of any scored survivor.
  rest.sort((a, b) => scoreOf(a) - scoreOf(b));

  const replacedUuids: string[] = [];
  for (let i = 0; i < replaceCount; i++) {
    const victim = rest[i];
    if (victim.uuid) {
      replacedUuids.push(victim.uuid);
    }
    // Do NOT dispose(): the victim may still be referenced by the breeding
    // genus (shared elites/survivors). Disposing empties its neurons and
    // corrupts that shared reference. Just drop it from the population.
    rest[i] = makeImmigrant();
  }

  // Rebuild the population in place: preserved elites followed by the
  // (re-populated) non-elite slice.
  population.length = safeElite;
  for (let i = 0; i < rest.length; i++) {
    population.push(rest[i]);
  }

  return { injected: replaceCount, replacedUuids };
}

/** Score used for worst-first ranking; missing scores rank as weakest. */
function scoreOf(creature: Creature): number {
  return typeof creature.score === "number" ? creature.score : -Infinity;
}
