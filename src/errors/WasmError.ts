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
  | "MODULE_NOT_LOADED";

export class WasmError extends Error {
  override readonly name = "WasmError";
  readonly reason: WasmErrorReason;

  constructor(message: string, reason: WasmErrorReason) {
    super(message);
    this.reason = reason;
  }
}
