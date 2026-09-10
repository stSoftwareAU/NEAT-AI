/**
 * Shared fixtures for the Issue #3930 surrogate study tests.
 *
 * One deterministic generator, defined once: two test files drawing from two
 * private copies of the same arithmetic is how a "reproducible" study stops
 * being reproducible.
 */

/** A deterministic linear-congruential stream in `[0, 1)`. */
export function testRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
