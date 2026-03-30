/**
 * DataFuzzing.ts - In-place noise injection for training data.
 *
 * Issue #1900: Applies small random perturbations to training data
 * buffers to prevent memorisation. Supports Gaussian and uniform
 * noise distributions.
 *
 * Reference: Bishop (1995), "Training with Noise is Equivalent to
 * Tikhonov Regularisation", Neural Computation.
 */

import type { RandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";

/**
 * Apply noise in-place to a Float32Array buffer.
 *
 * - **Gaussian**: Adds `scale * gaussian()` to each element using
 *   the Box-Muller transform.
 * - **Uniform**: Adds `scale * (2 * random() - 1)` to each element,
 *   producing noise in [-scale, +scale].
 *
 * @param buffer - The data buffer to perturb in place
 * @param scale - Standard deviation (Gaussian) or half-width (uniform)
 * @param noiseType - Distribution: "gaussian" or "uniform"
 * @param rng - Random number generator for reproducibility
 */
export function applyNoise(
  buffer: Float32Array,
  scale: number,
  noiseType: "gaussian" | "uniform",
  rng: RandomNumberGenerator,
): void {
  if (scale <= 0) return;

  const len = buffer.length;

  if (noiseType === "uniform") {
    for (let i = 0; i < len; i++) {
      buffer[i] += scale * (2 * rng.random() - 1);
    }
  } else {
    // Gaussian noise via Box-Muller transform.
    // Generate pairs of Gaussian samples for efficiency.
    let i = 0;
    for (; i + 1 < len; i += 2) {
      const [g1, g2] = boxMuller(rng);
      buffer[i] += scale * g1;
      buffer[i + 1] += scale * g2;
    }
    // Handle odd-length buffer.
    if (i < len) {
      const [g1] = boxMuller(rng);
      buffer[i] += scale * g1;
    }
  }
}

/**
 * Box-Muller transform: generates two independent standard normal
 * samples from two uniform [0, 1) samples.
 */
function boxMuller(rng: RandomNumberGenerator): [number, number] {
  let u1 = rng.random();
  // Avoid log(0) by rejecting exact zero.
  while (u1 === 0) {
    u1 = rng.random();
  }
  const u2 = rng.random();
  const mag = Math.sqrt(-2 * Math.log(u1));
  const angle = 2 * Math.PI * u2;
  return [mag * Math.cos(angle), mag * Math.sin(angle)];
}
