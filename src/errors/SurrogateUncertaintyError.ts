/**
 * Typed error for the surrogate uncertainty guard — Issue #3933.
 *
 * Jin (2011) §5 names one failure mode the rest of the surrogate sweep is
 * unsafe without: an evolutionary algorithm finds and exploits the *consistent*
 * mistakes of its model, converges to an optimum of the model that is not an
 * optimum of the objective, and draws a fitness trace that looks excellent the
 * whole way because the trace is drawn from the model.
 *
 * Every reason here is a case where that is about to happen quietly. None may
 * be downgraded to a warning: a surrogate whose uncertainty is missing, whose
 * acquisition rule has degenerated to an argmax, or whose coverage region was
 * never fitted still ranks candidates, and the run still looks healthy.
 *
 * @module SurrogateUncertaintyError
 */

export type SurrogateUncertaintyErrorReason =
  /**
   * A prediction carried a value or an uncertainty that cannot be acted on —
   * non-finite, or a negative standard deviation. There is no nullable
   * uncertainty path, so this is the only way one can be absent.
   */
  | "INVALID_PREDICTION"
  /**
   * A coverage region was asked to classify a descriptor of the wrong width,
   * or was fitted to a training set it cannot describe a region from.
   */
  | "INVALID_COVERAGE_REGION"
  /**
   * The acquisition rule allocated fewer exact evaluations to high-uncertainty
   * candidates than the configured floor, with candidates available to fill
   * it — the signature of an acquisition rule that has degenerated to argmax.
   */
  | "UNCERTAINTY_FLOOR_BREACHED"
  /**
   * An allocation was asked for over inputs that do not line up: more slots
   * than candidates cannot be honoured, and a negative slot count is a caller
   * bug rather than an empty allocation.
   */
  | "INVALID_ALLOCATION_REQUEST";

export class SurrogateUncertaintyError extends Error {
  override readonly name = "SurrogateUncertaintyError";
  readonly reason: SurrogateUncertaintyErrorReason;

  constructor(message: string, reason: SurrogateUncertaintyErrorReason) {
    super(message);
    this.reason = reason;
  }
}
