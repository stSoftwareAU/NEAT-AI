export class ErrorHelper {
  /**
   * Clamps error to a maximum absolute magnitude.
   * Fast, branch-light. Avoids NaN propagation.
   *
   * @param error Raw error value (usually from derivative)
   * @param maxMagnitude Maximum allowed absolute value (default: 100)
   * @returns Clamped error
   */
  static calculateClampedError(
    error: number,
    maxMagnitude: number = 100,
  ): number {
    if (!Number.isFinite(error)) return 0;

    if (error > maxMagnitude) return maxMagnitude;
    if (error < -maxMagnitude) return -maxMagnitude;

    return error;
  }
}
