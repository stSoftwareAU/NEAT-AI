/**
 * Typed error for a `rust_scorer` failure raised under strict mode.
 *
 * Issue #3815: the native scorer degrades to WASM scoring when it cannot be
 * executed or its output cannot be parsed. That is the right *production*
 * behaviour, but it made an entirely dead native path look green in CI — Issue
 * #3810 had `rust_scorer` rejecting every creature carrying a `memetic` block
 * for an unknown length of time, visible only as stderr noise.
 *
 * With `NEAT_AI_RUST_SCORER_STRICT=1` the same failure throws a
 * `ScorerStrictError` instead of being logged and reconciled to a successful
 * run. The scorer's stderr is carried **verbatim** on {@link stderr} and
 * appended to the message so the real diagnostic is the failure text, not
 * something buried in hundreds of repeated log lines.
 *
 * @module ScorerStrictError
 */

export type ScorerStrictReason =
  /** The scorer process exited non-zero, or could not be spawned at all. */
  | "EXEC_FAILURE"
  /** The process succeeded but its stdout could not be parsed/reconciled. */
  | "INVALID_OUTPUT"
  /** A batch generation fell back to the per-creature/WASM path. */
  | "BATCH_FALLBACK";

/** Options carrying the scorer diagnostics onto the error. */
export interface ScorerStrictErrorOptions {
  /** Exit code of the scorer process, when one was produced. */
  exitCode?: number;
  /** Raw, untrimmed stderr from the scorer process. */
  stderr?: string;
  /** Underlying error being escalated, preserved for the stack. */
  cause?: unknown;
}

export class ScorerStrictError extends Error {
  override readonly name = "ScorerStrictError";
  readonly reason: ScorerStrictReason;
  /** Exit code of the scorer process (`undefined` when it never ran). */
  readonly exitCode: number | undefined;
  /** The scorer's stderr, verbatim — never trimmed or whitespace-collapsed. */
  readonly stderr: string;

  constructor(
    message: string,
    reason: ScorerStrictReason,
    options: ScorerStrictErrorOptions = {},
  ) {
    const stderr = options.stderr ?? "";
    // The whole point of strict mode is that the operator reads the scorer's
    // own diagnostic, so it goes in the message as well as on the field.
    super(
      stderr.length > 0
        ? `${message}\n--- rust_scorer stderr ---\n${stderr}`
        : message,
      { cause: options.cause },
    );
    this.reason = reason;
    this.exitCode = options.exitCode;
    this.stderr = stderr;
  }
}

/**
 * Escalate an arbitrary failure to a {@link ScorerStrictError}, preserving an
 * already-typed strict error unchanged (its verbatim stderr is not re-wrapped).
 *
 * @param error - The failure being escalated.
 * @param message - Context prefix for a newly created error.
 * @param reason - Reason recorded when a new error is created.
 * @param stderr - Raw scorer stderr to carry, when available.
 */
export function toScorerStrictError(
  error: unknown,
  message: string,
  reason: ScorerStrictReason,
  stderr?: string,
): ScorerStrictError {
  if (error instanceof ScorerStrictError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new ScorerStrictError(`${message}: ${detail}`, reason, {
    stderr,
    cause: error,
  });
}
