/**
 * Per-isolate ledger of native-scoring fallbacks (Issue #3866).
 *
 * A `rust_scorer` fallback used to be observable but never a verdict: the batch
 * catch in `Fitness` set a per-generation boolean that is reset every
 * generation, and the **per-creature** path (`tryScoreWithRustScorer` returning
 * `undefined`) set nothing at all. A run where every creature quietly scored on
 * WASM therefore reconciled to green — the exact class of failure Issue #3810
 * exposed.
 *
 * This module is the missing half: the per-creature scorer records here when an
 * *available* native scorer failed and the caller degraded to WASM. The ledger
 * is module state, so it is per-isolate — the per-creature path runs inside
 * evaluation workers, and each worker reports its own flag back to the main
 * thread on the evaluate response, where `Fitness` folds it into the
 * per-generation verdict and `ScorerUtilisationTotals` accumulates it for the
 * whole run.
 *
 * **A graceful skip is not a fallback.** No binary installed, or a binary too
 * old to honour the configured cost, means native scoring was never available —
 * that must stay a clean run so contributors without `rust_scorer` can run
 * `deno test`. Only a scorer that was there and failed is recorded here.
 *
 * @module NativeScoringFallbackLedger
 */

/** True once an available native scorer failed and WASM took over. */
let fallbackObserved = false;

/**
 * Record that an eligible native scoring attempt degraded to the WASM path.
 *
 * Call this **only** for a genuine degradation — an exec failure, unparseable
 * output, or a non-finite error from a scorer that was present. Never call it
 * for a graceful skip (scorer disabled, absent, or too old).
 */
export function recordNativeScoringFallback(): void {
  fallbackObserved = true;
}

/**
 * Read the flag and clear it, so the next unit of work (one worker evaluate
 * call, one generation) starts from a clean slate.
 *
 * @returns True when a native-scoring fallback happened since the last read.
 */
export function consumeNativeScoringFallback(): boolean {
  const observed = fallbackObserved;
  fallbackObserved = false;
  return observed;
}

/** Clear the ledger without reading it (test and bridge-reset hook). */
export function resetNativeScoringFallback(): void {
  fallbackObserved = false;
}
