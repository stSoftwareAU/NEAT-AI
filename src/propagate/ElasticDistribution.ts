/**
 * Error distribution helpers for back propagation.
 *
 * We use a minimum-change heuristic for a linear pre-activation:
 *   v = b + Σ(w_i * a_i)
 *
 * If we want to change v by Δv, the smallest L2 change in weights that achieves
 * the same Δv (with bias handled separately) allocates contribution changes
 * proportional to \(a_i^2\).
 *
 * This is an "elasticity" mechanism: links with larger activations can absorb
 * more of the value-space error with smaller weight changes, and links that are
 * near saturation can be down-weighted via `safeZoneFactor`.
 *
 * Notes:
 * - `safeZoneFactor` is expected in [0, 1], but we clamp defensively.
 * - If nothing is movable (all scores ~0), we fall back to an equal split so we
 *   still break symmetry (eg. when activations are all zero early in training).
 *
 * Australian English: "normalise", "behaviour".
 */
export type ElasticLink = Readonly<{
  activation: number;
  safeZoneFactor: number;
  /** Optional synapse weight, used for weight-based fallback when activations are near zero. */
  weight?: number;
}>;

export function distributeElasticError(
  error: number,
  links: ReadonlyArray<ElasticLink>,
  options?: Readonly<{
    plankConstant?: number;
  }>,
): number[] {
  const plankConstant = options?.plankConstant ?? 1e-12;

  if (!Number.isFinite(error) || links.length === 0) {
    return new Array(links.length).fill(0);
  }

  const scores = new Array<number>(links.length);
  let denom = 0;
  for (let i = 0; i < links.length; i++) {
    const { activation, safeZoneFactor } = links[i];
    if (!Number.isFinite(activation) || !Number.isFinite(safeZoneFactor)) {
      scores[i] = 0;
      continue;
    }

    const safe = Math.max(0, Math.min(1, safeZoneFactor));
    const a2 = activation * activation;
    const score = a2 * safe;
    scores[i] = score;
    denom += score;
  }

  if (denom <= plankConstant) {
    // Primary fallback: weight-based scoring (weight²).
    // When activations are near zero the minimum-change heuristic is
    // underdetermined. Links with larger weights carry more influence and
    // should absorb proportionally more error — mirroring the record-time
    // elasticity approach (RecordElasticity.ts uses weight²).
    let weightDenom = 0;
    const weightScores = new Array<number>(links.length);
    for (let i = 0; i < links.length; i++) {
      const w = (links[i] as { weight?: number }).weight;
      const w2 = (w !== null && w !== undefined && Number.isFinite(w))
        ? w * w
        : 0;
      weightScores[i] = w2;
      weightDenom += w2;
    }

    if (weightDenom > plankConstant) {
      const weightShares = new Array<number>(links.length);
      let wSum = 0;
      for (let i = 0; i < links.length; i++) {
        const share = error * (weightScores[i] / weightDenom);
        weightShares[i] = share;
        wSum += share;
      }
      // Floating-point tidy-up
      const wResidue = error - wSum;
      if (Math.abs(wResidue) > plankConstant) {
        let bestIdx = 0;
        for (let i = 1; i < weightScores.length; i++) {
          if (weightScores[i] > weightScores[bestIdx]) bestIdx = i;
        }
        weightShares[bestIdx] += wResidue;
      }
      return weightShares;
    }

    // Last resort: equal split when both activations and weights are zero.
    const per = error / links.length;
    return new Array(links.length).fill(per);
  }

  const shares = new Array<number>(links.length);
  let sum = 0;
  for (let i = 0; i < links.length; i++) {
    const share = error * (scores[i] / denom);
    shares[i] = share;
    sum += share;
  }

  // Keep Σ shares == error (floating point tidy-up).
  const residue = error - sum;
  if (Math.abs(residue) > plankConstant) {
    let bestIndx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] > bestScore) {
        bestScore = scores[i];
        bestIndx = i;
      }
    }
    if (bestIndx >= 0) {
      shares[bestIndx] += residue;
    }
  }

  return shares;
}
