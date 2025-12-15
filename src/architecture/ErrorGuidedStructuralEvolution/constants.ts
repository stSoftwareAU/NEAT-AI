/**
 * Default number of records to accumulate before flushing discovery data to Rust.
 *
 * This matches the legacy behaviour (4_096 records) that balances IO pressure
 * and memory usage during multi-file discovery runs.
 */
export const DEFAULT_RUST_FLUSH_RECORDS = 4_096;

/**
 * Maximum number of records to stream to the Rust recorder in a single call.
 * This keeps JSON payloads bounded during discovery flushes to avoid OOMs.
 */
export const DEFAULT_RUST_STREAM_RECORDS = 512;

/**
 * Default estimated payload size threshold (in bytes) before flushing a Rust
 * discovery chunk.
 *
 * This is a conservative ceiling to avoid V8's maximum string length during
 * JSON.stringify() when preparing FFI payloads (e.g. "Invalid string length").
 */
export const DEFAULT_RUST_FLUSH_BYTES = 50 * 1024 * 1024; // ~50 MiB
