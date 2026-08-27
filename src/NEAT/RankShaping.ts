/**
 * RankShaping.ts — rank-based fitness shaping (Issue #3909).
 *
 * Salimans, Ho, Chen, Sidor & Sutskever 2017, *Evolution Strategies as a
 * Scalable Alternative to Reinforcement Learning*
 * (https://arxiv.org/abs/1703.03864) replaces raw returns with their
 * **centred ranks** within the population before computing an update. The
 * transform costs almost nothing and buys two things: a single outlier can
 * no longer dominate, and the result no longer depends on the numeric scale
 * of the objective.
 *
 * NEAT-AI reuses that idea in two scale-dependent places:
 *
 * 1. **Metropolis-Hastings acceptance.** `exp(-delta / T)` only means
 *    something relative to the numeric spread of the current cost
 *    distribution — which moves when the corpus moves, when the cost
 *    function changes, and slowly as the population converges. Under
 *    {@link rankShapedDelta} the value fed to M-H is the candidate's
 *    **quantile among recent worsening proposals**, so a temperature means
 *    the same thing at every stage of a run.
 * 2. **Parent selection.** {@link centredRanks} is offered as an alternative
 *    to the GRPO z-score in `buildGroupRelativeAdvantageMap`, so a cohort
 *    with one freak score does not flatten every other member's signal.
 *
 * The authoritative scorer verdict is deliberately **not** rank-shaped —
 * that is the one place the absolute number is the point.
 *
 * The module is a pure function library plus one small bounded buffer: no
 * Creature, Genus, or Mutator imports.
 */

/** Default number of recent proposal deltas retained as the rank reference. */
export const DEFAULT_RANK_SHAPING_WINDOW = 128;

/**
 * Salimans et al. 2017 centred rank transform.
 *
 * Each finite entry is replaced by `rank / (m - 1) - 0.5`, where `rank` is
 * its 0-based ascending position among the `m` finite entries and ties share
 * the average of the ranks they span. The result therefore spans
 * `[-0.5, +0.5]`, is invariant to any strictly increasing rescaling of the
 * inputs, and sums to zero.
 *
 * Guarantees:
 *
 * - **Empty cohort** returns `[]`; a **single-member** cohort returns `[0]`.
 * - **Every value identical** returns all zeros (every rank is the same
 *   averaged rank, which is the centre).
 * - **Non-finite entries** receive `0` and take no part in the ranking,
 *   matching `computeGroupRelativeAdvantages`.
 *
 * @param values - The cohort values (higher is better for fitness use)
 * @returns A new array of centred ranks, same length and order as `values`
 */
export function centredRanks(values: readonly number[]): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0) return out;

  const finite: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(values[i])) finite.push(i);
  }
  const m = finite.length;
  if (m <= 1) return out;

  finite.sort((a, b) => values[a] - values[b]);

  // Assign 0-based ranks, averaging across each run of equal values so ties
  // cannot be split by array order.
  for (let start = 0; start < m;) {
    let end = start + 1;
    while (end < m && values[finite[end]] === values[finite[start]]) end++;
    const averageRank = (start + end - 1) / 2;
    const centred = averageRank / (m - 1) - 0.5;
    for (let k = start; k < end; k++) out[finite[k]] = centred;
    start = end;
  }
  return out;
}

/**
 * The plotting-position quantile of `value` within `reference`, in `(0, 1)`.
 *
 *     q = (count(reference <= value) + 0.5) / (reference.length + 1)
 *
 * The `+ 0.5 / + 1` correction keeps the result strictly inside `(0, 1)`, so
 * neither "certainly accept" nor "certainly reject" can be produced by a
 * short or lopsided reference. An **empty** reference yields exactly `0.5`:
 * no information, so no opinion.
 *
 * Non-finite reference entries are skipped; a non-finite `value` yields
 * `0.5` for the same reason.
 *
 * @param value - The value to rank
 * @param reference - The empirical reference distribution
 */
export function rankQuantile(
  value: number,
  reference: readonly number[],
): number {
  if (!Number.isFinite(value)) return 0.5;
  let below = 0;
  let count = 0;
  for (const r of reference) {
    if (!Number.isFinite(r)) continue;
    count++;
    if (r <= value) below++;
  }
  if (count === 0) return 0.5;
  return (below + 0.5) / (count + 1);
}

/**
 * Rank-shapes a raw Metropolis-Hastings cost delta against a reference
 * distribution of recently observed raw deltas.
 *
 * - **Improving or neutral** proposals (`rawDelta <= 0`) are returned
 *   unchanged. M-H accepts them unconditionally, and rank-shaping them could
 *   only manufacture a rejection of a strict improvement — the one outcome
 *   the criterion must never produce.
 * - **Worsening** proposals return their quantile among the *worsening*
 *   entries of `reference`, in `(0, 1)`. Only worsening proposals are ever
 *   subject to the probabilistic test, so ranking against improving ones
 *   would push every worsening move toward the top of the distribution.
 * - A **non-finite** delta returns `0`, matching
 *   `normaliseDeltaWithCohortStd`, rather than propagating `NaN` into
 *   `Math.exp`.
 *
 * Because the result depends only on the *ordering* of the deltas, scaling
 * every cost by a positive constant leaves the acceptance probability
 * untouched — the scale invariance the transform exists to provide.
 *
 * @param rawDelta - Raw `post - pre` cost delta
 * @param reference - Recently observed raw deltas (any sign)
 * @returns The shaped delta to feed to `metropolisHastingsAccept`
 */
export function rankShapedDelta(
  rawDelta: number,
  reference: readonly number[],
): number {
  if (!Number.isFinite(rawDelta)) return 0;
  if (rawDelta <= 0) return rawDelta;
  const worsening: number[] = [];
  for (const r of reference) {
    if (Number.isFinite(r) && r > 0) worsening.push(r);
  }
  return rankQuantile(rawDelta, worsening);
}

/**
 * A bounded ring buffer of recently observed raw M-H cost deltas, used as
 * the reference cohort for {@link rankShapedDelta}.
 *
 * The window lives on `MCMCState`, so it spans generations: a single
 * generation only proposes `populationSize * mutationRate` weight/bias
 * mutations, which is too thin a cohort to rank against on its own.
 */
export class RankShapingWindow {
  private readonly capacity: number;
  private readonly buffer: number[] = [];
  private next = 0;

  /**
   * @param capacity - Maximum retained deltas; non-finite or non-positive
   *   values fall back to {@link DEFAULT_RANK_SHAPING_WINDOW}
   */
  constructor(capacity: number = DEFAULT_RANK_SHAPING_WINDOW) {
    this.capacity = Number.isFinite(capacity) && capacity >= 1
      ? Math.floor(capacity)
      : DEFAULT_RANK_SHAPING_WINDOW;
  }

  /** Number of deltas currently retained. */
  get size(): number {
    return this.buffer.length;
  }

  /**
   * Records one observed raw delta, evicting the oldest entry once the
   * window is full. Non-finite deltas are ignored — they carry no ordering
   * information and would poison the reference.
   */
  record(rawDelta: number): void {
    if (!Number.isFinite(rawDelta)) return;
    if (this.buffer.length < this.capacity) {
      this.buffer.push(rawDelta);
      return;
    }
    this.buffer[this.next] = rawDelta;
    this.next = (this.next + 1) % this.capacity;
  }

  /**
   * Rank-shapes `rawDelta` against the retained window without recording it,
   * so the candidate never ranks against itself.
   */
  shape(rawDelta: number): number {
    return rankShapedDelta(rawDelta, this.buffer);
  }

  /** Empties the window (used by `MCMCState.reset`). */
  reset(): void {
    this.buffer.length = 0;
    this.next = 0;
  }
}
