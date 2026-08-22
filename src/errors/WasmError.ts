/**
 * Typed error for WASM activation failures.
 *
 * Consumers can catch `WasmError` and inspect `reason` to handle
 * specific failure modes programmatically.
 *
 * @module WasmError
 */

export type WasmErrorReason =
  | "COMPILATION_FAILED"
  | "ACTIVATION_FAILED"
  | "MODULE_NOT_LOADED"
  /**
   * Issue #3803: a request never reached the Rust rules — the bridge built a
   * payload core could not read, or core answered with something that is not a
   * response. It is a bridge fault, not a verdict on the creature, so it is
   * raised rather than reported as a validation failure.
   */
  | "INVALID_REQUEST";

export class WasmError extends Error {
  override readonly name = "WasmError";
  readonly reason: WasmErrorReason;

  /**
   * @param message Human-readable description of the failure.
   * @param reason Programmatic discriminator for the failure mode.
   * @param options Optional standard `ErrorOptions`; `cause` is preserved so
   *   downstream diagnostics can still inspect the underlying trap (Issue
   *   #2658).
   */
  constructor(
    message: string,
    reason: WasmErrorReason,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.reason = reason;
  }
}
