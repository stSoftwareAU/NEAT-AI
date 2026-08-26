/**
 * Wire contract for NEAT-AI-Discovery's structured error classification
 * (Issues #2116, #3892).
 *
 * Discovery classifies every FFI failure with the Rust enum
 * `DiscoveryErrorKind`, which is serialised with
 * `#[serde(rename_all = "snake_case")]`. The JSON that crosses the boundary
 * therefore carries `gpu_permanent`, never the Rust variant name
 * `GpuPermanent` — the mismatch that reddened the GPU guard test on GPU-less
 * workers. Compare against these values, not against the Rust identifiers.
 */

/**
 * Every `errorKind` Discovery can emit, in the exact spelling it puts on the
 * wire. Mirrors `DiscoveryErrorKind` in
 * `NEAT-AI-Discovery/src/ffi_types/error_classification.rs`; adding a variant
 * there means adding it here in the same spelling.
 */
export const RUST_DISCOVERY_ERROR_KINDS = [
  /** Transient GPU error (device lost, driver reset) — retryable. */
  "gpu_transient",
  /** Permanent GPU error (no adapter, unsupported hardware) — not retryable. */
  "gpu_permanent",
  /** GPU present but wedged for the rest of the process — not retryable. */
  "gpu_wedged",
  /** Malformed input or missing fields — not retryable. */
  "data_validation",
  /** Deadline exceeded — retryable with a longer deadline. */
  "timeout",
  /** Memory exhaustion — retryable after freeing resources. */
  "memory_exhausted",
  /** Parquet read/write failure — may be retryable. */
  "io_error",
  /** Panic caught at the FFI boundary — not retryable. */
  "internal_panic",
  /** Host-requested graceful cancellation — not an error. */
  "cancelled",
  /** Unclassified — read the accompanying error message. */
  "unknown",
] as const;

/** One of the `errorKind` strings Discovery puts on the wire. */
export type RustDiscoveryErrorKind = typeof RUST_DISCOVERY_ERROR_KINDS[number];

/**
 * Narrows an arbitrary wire value to a known {@link RustDiscoveryErrorKind}.
 *
 * A Discovery build newer than this mirror can emit a kind we do not know, so
 * callers that branch on the classification must check rather than assume.
 */
export function isRustDiscoveryErrorKind(
  value: unknown,
): value is RustDiscoveryErrorKind {
  return typeof value === "string" &&
    (RUST_DISCOVERY_ERROR_KINDS as readonly string[]).includes(value);
}
