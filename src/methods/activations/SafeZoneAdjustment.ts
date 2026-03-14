/**
 * Shared safe zone adjustment logic for activation functions.
 *
 * Determines whether it is appropriate to propagate error to upstream neurons,
 * or instead adjust the synaptic weight or bias.
 *
 * The logic is:
 *   - If rawInput is non-finite, return 0 (no propagation).
 *   - If rawInput is inside [safeMin, safeMax], return 1 (full propagation),
 *     unless the weight is extreme and improving, in which case return 0.
 *   - If rawInput is outside the safe zone and the error would worsen it, return 0.
 *   - In the fade zone (safeMax to safeMax+fadeWidth, or safeMin-fadeWidth to safeMin),
 *     linearly interpolate between 1 and 0.
 *   - Beyond the fade zone, return 0.
 *
 * @param rawInput - Raw input to the activation function.
 * @param error - Error signal.
 * @param weight - Incoming synapse weight.
 * @param safeMin - Lower bound of the safe zone.
 * @param safeMax - Upper bound of the safe zone.
 * @param fadeWidth - Width of the fade zone beyond safe bounds (default 10).
 * @returns A number between 0 and 1 representing propagation safety.
 */
export function safeZoneAdjustment(
  rawInput: number,
  error: number,
  weight: number,
  safeMin: number,
  safeMax: number,
  fadeWidth = 10,
): number {
  if (!Number.isFinite(rawInput)) return 0;

  const inSafeRange = rawInput >= safeMin && rawInput <= safeMax;

  const rawGettingWorse = (rawInput < safeMin && error < 0) ||
    (rawInput > safeMax && error > 0);

  const absWeight = Math.abs(weight);
  const minWeight = 1e-3;
  const maxWeight = 1e3;
  const weightTooSmall = absWeight < minWeight;
  const weightTooLarge = absWeight > maxWeight;
  const weightImproving = (weightTooSmall && weight * error > 0) ||
    (weightTooLarge && weight * error < 0);

  if (!inSafeRange && rawGettingWorse) return 0;
  if (inSafeRange && (weightTooSmall || weightTooLarge) && weightImproving) {
    return 0;
  }

  if (inSafeRange) return 1;

  if (rawInput > safeMax && rawInput <= safeMax + fadeWidth) {
    return 1 - (rawInput - safeMax) / fadeWidth;
  }
  if (rawInput < safeMin && rawInput >= safeMin - fadeWidth) {
    return 1 - (safeMin - rawInput) / fadeWidth;
  }

  return 0;
}
