/**
 * EvolveRLSeedSet.ts — Deterministic seed-set helper for `Creature.evolveRL()`
 * (Issue #2628, part of #2624).
 *
 * Per-generation seed set: every creature in generation `g` plays the same
 * `seedSet(g) = [hash(baseSeed, g, 0), …, hash(baseSeed, g, episodes - 1)]`,
 * so per-creature fitness comparisons inside the generation are fair. The
 * seed set rotates between generations because `g` is mixed into the hash.
 *
 * When `fixedSeedSet === true` the seed set is collapsed to `seedSet(0)` for
 * every generation — useful only for tests / regression checks where the
 * caller wants deterministic, non-rotating seeds. Real evolution should
 * always rotate, otherwise creatures over-fit one map.
 *
 * The hash uses a small MurmurHash3-style 32-bit mixer: each input is
 * combined with prime multipliers and xorshifts so changing any one input
 * — base, generation, or trial — flips most output bits. This keeps adjacent
 * generations / trials uncorrelated in seed space without dragging in a
 * heavyweight RNG dependency.
 */

/**
 * Mix `baseSeed`, `generation`, and `trial` into a 32-bit unsigned integer.
 *
 * The function is pure and deterministic: identical inputs always return
 * the same output across runs, processes, and machines. Adjacent
 * generations or trials produce uncorrelated outputs — useful when an
 * adapter keys observations off the seed.
 */
export function deriveRLSeed(
  baseSeed: number,
  generation: number,
  trial: number,
): number {
  // Coerce inputs to 32-bit unsigned. Math.imul gives consistent 32-bit
  // multiplication semantics under JavaScript's 64-bit floats.
  let h = (baseSeed | 0) >>> 0;
  h = Math.imul(h ^ ((generation | 0) >>> 0), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ ((trial | 0) >>> 0), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

/**
 * Build the seed set for generation `generation`.
 *
 * @param baseSeed — Base seed supplied via `EvolveRLOptions.seed`.
 * @param generation — 1-based generation counter. Pass `0` for both
 *   generations when `fixedSeedSet === true`.
 * @param episodesPerCreature — Length of the returned seed set; must be a
 *   positive integer.
 * @param fixedSeedSet — When `true`, ignore `generation` and always use
 *   generation `0` so every generation uses the same seed set. Default
 *   `false` (rotation enabled).
 */
export function buildRLSeedSet(
  baseSeed: number,
  generation: number,
  episodesPerCreature: number,
  fixedSeedSet = false,
): number[] {
  if (
    !Number.isFinite(episodesPerCreature) ||
    !Number.isInteger(episodesPerCreature) ||
    episodesPerCreature <= 0
  ) {
    throw new Error(
      `episodesPerCreature must be a positive integer, got ${episodesPerCreature}`,
    );
  }
  const effectiveGeneration = fixedSeedSet ? 0 : generation;
  const seeds: number[] = new Array(episodesPerCreature);
  for (let i = 0; i < episodesPerCreature; i++) {
    seeds[i] = deriveRLSeed(baseSeed, effectiveGeneration, i);
  }
  return seeds;
}
