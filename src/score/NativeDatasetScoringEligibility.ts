/**
 * @module
 *
 * The single place that decides whether the native `rust_scorer` may serve a
 * dataset-scoring request, or whether the TypeScript/WASM path must keep it.
 *
 * Issue #3854: the long-term goal is **one** dataset-scoring implementation —
 * the native one — with the TypeScript path demoted to the cases the native
 * engine provably cannot serve. Getting there safely means the boundary has to
 * be explicit and honest first, because a silent delegation to an engine with
 * different semantics is worse than no delegation at all. Three such silent
 * divergences existed before this module:
 *
 * 1. **Custom costs** (Issue #2745). `rust_scorer` cannot resolve a
 *    user-registered {@link CostInterface}, so a custom cost stays on the
 *    TypeScript path — `docs/api/COSTS_AND_ACTIVATIONS.md` documents that as a
 *    public promise. The per-creature call site honoured it, but the batch
 *    call site did not: `NeatConfig.costName` keeps its `"MSE"` default even
 *    when `customCost` replaces the built-in cost (Issue #3776), so the batch
 *    scorer was handed `--cost MSE` while the workers evaluated the custom
 *    cost. Hence {@link NativeScoringRequest.customCostConfigured}.
 * 2. **`outputRanges`** (Issue #1620). The additive out-of-range penalty is a
 *    TypeScript-only concept; `rust_scorer` has no output-range notion, so
 *    delegating dropped the penalty entirely and every creature scored as if
 *    the constraint were not configured.
 * 3. **`feedbackLoop` on a recurrent creature.** The native recurrent path
 *    resets network state per record unconditionally — i.e. `feedbackLoop:
 *    false` semantics. A recurrent creature evaluated with `feedbackLoop: true`
 *    therefore got a different number from each engine.
 *
 * Each refusal is a *named* reason rather than a bare boolean so callers can
 * log, count, or assert on why the native path was skipped. Adding a native
 * capability means deleting a reason here, not loosening a condition at a call
 * site.
 */
import { BUILT_IN_COST_NAMES, type BuiltInCostName } from "@costs";

/** Why the native dataset scorer was not used for a scoring request. */
export type NativeScoringRefusal =
  /**
   * The configured cost is user-registered. `rust_scorer` only knows
   * {@link BUILT_IN_COST_NAMES} (Issue #2745).
   */
  | "CUSTOM_COST"
  /**
   * `outputRanges` are configured. The out-of-range penalty has no native
   * equivalent, so delegating would silently drop it (Issue #1620).
   */
  | "OUTPUT_RANGES"
  /**
   * A recurrent creature is being scored with `feedbackLoop: true`. The native
   * recurrent path resets state per record, which is `feedbackLoop: false`.
   */
  | "FEEDBACK_LOOP";

/** Inputs to the delegation decision. */
export interface NativeScoringRequest {
  /** Configured cost name — built-in or user-registered. */
  readonly costName: string;
  /**
   * A `customCost` module is configured (Issue #3776 keeps `costName` at its
   * "MSE" default in that case, so the name alone cannot reveal it). Callers
   * that resolve the real {@link CostInterface} first — and therefore see the
   * registered custom name in `costName` — can leave this unset.
   */
  readonly customCostConfigured?: boolean;
  /**
   * `creature.forwardOnlyGuaranteed`. When true the creature carries no state
   * between records, so `feedbackLoop` cannot change the result.
   */
  readonly forwardOnlyGuaranteed: boolean;
  /** The `feedbackLoop` setting the TypeScript path would apply. */
  readonly feedbackLoop: boolean;
  /** Number of configured output-range constraints (0 when unset). */
  readonly outputRangeCount: number;
}

/**
 * The decision. Exactly one of {@link costName} / {@link refusedBecause} is
 * set: a built-in cost name to hand `rust_scorer --cost`, or the named reason
 * the request stays on the TypeScript/WASM path.
 */
export type NativeScoringEligibility =
  | { readonly eligible: true; readonly costName: BuiltInCostName }
  | { readonly eligible: false; readonly refusedBecause: NativeScoringRefusal };

/** True when `costName` is one of the seven built-in costs. */
export function isBuiltInCostName(
  costName: string,
): costName is BuiltInCostName {
  return (BUILT_IN_COST_NAMES as readonly string[]).includes(costName);
}

/**
 * Decide whether `rust_scorer` may score this dataset request.
 *
 * Refusal order is deliberate and stable: cost support first (the coarsest
 * capability gap), then output ranges, then feedback-loop semantics. A request
 * that trips several conditions reports the first, so the reason a caller logs
 * does not flap as unrelated options change.
 */
export function nativeDatasetScoringEligibility(
  request: NativeScoringRequest,
): NativeScoringEligibility {
  if (request.customCostConfigured || !isBuiltInCostName(request.costName)) {
    return { eligible: false, refusedBecause: "CUSTOM_COST" };
  }
  if (request.outputRangeCount > 0) {
    return { eligible: false, refusedBecause: "OUTPUT_RANGES" };
  }
  if (!request.forwardOnlyGuaranteed && request.feedbackLoop) {
    return { eligible: false, refusedBecause: "FEEDBACK_LOOP" };
  }
  return { eligible: true, costName: request.costName };
}
