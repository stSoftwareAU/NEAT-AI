/**
 * Typed error for a repair pass that refused its own result (Issue #3848).
 *
 * A repair exists to hand back something better than it was given. When it
 * cannot, the honest answer is to say so: a `RepairError` is raised instead of
 * a damaged creature being returned as though the repair had worked. Silently
 * handing back damage is what let #3845 cost a champion 90.7 % of its score
 * without a single log line.
 *
 * @module RepairError
 */

export type RepairErrorReason =
  /**
   * The repair moved role-typed structure on an `IF` no failing rule named —
   * the #3845 damage exactly. An `IF`'s branch edges matter by presence and
   * source, and a bias-1 constant feeding one is the leaf value itself, so a
   * pass that cannot interpret them must leave them alone.
   */
  | "ROLE_REWIRING"
  /**
   * The creature could be activated before the repair and cannot be after, or
   * now produces non-finite outputs where it produced finite ones. Whatever the
   * repair fixed, the result is worse than what arrived.
   */
  | "BEHAVIOUR_LOST";

export class RepairError extends Error {
  override readonly name = "RepairError";
  readonly reason: RepairErrorReason;

  /**
   * @param message Human-readable description of what the repair refused.
   * @param reason Programmatic discriminator for the refusal.
   * @param options Optional standard `ErrorOptions`; `cause` carries the
   *   validation failure the repair was trying to resolve, when there is one.
   */
  constructor(
    message: string,
    reason: RepairErrorReason,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.reason = reason;
  }
}
