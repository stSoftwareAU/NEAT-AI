/**
 * Default number of records to accumulate before flushing discovery data to Rust.
 *
 * This matches the legacy behaviour (4_096 records) that balances IO pressure
 * and memory usage during multi-file discovery runs.
 */
export const DEFAULT_RUST_FLUSH_RECORDS = 4_096;

/**
 * Default estimated payload size threshold (in bytes) before flushing a Rust
 * discovery chunk.
 *
 * This is a conservative ceiling to avoid V8's maximum string length during
 * JSON.stringify() when preparing FFI payloads (e.g. "Invalid string length").
 */
export const DEFAULT_RUST_FLUSH_BYTES = 50 * 1024 * 1024; // ~50 MiB

/**
 * Multiplier applied to the accumulated per-sample estimate when deciding
 * whether to flush a Rust discovery chunk (Issue #3402).
 *
 * `rustAccumulatedEstimatedBytes` estimates the size of the *accumulator*
 * (`rustAccumulatedData` + `rustAccumulatedNeuronData`). But `writeRustParquetChunk`
 * transforms that accumulator into a **second**, plain-object FFI payload
 * (`rustTrainingData`: `Array.from` inputs/outputs plus a per-neuron object with
 * a UUID string and a copied errors array) that is held *simultaneously* with
 * the still-live accumulator during the FFI call. The true peak heap at flush is
 * therefore roughly double the accumulated estimate.
 *
 * Comparing only the accumulator estimate against `rustFlushBytesThreshold`
 * (whose documented purpose is to bound the FFI *payload*) lets the real peak
 * overshoot the threshold by the copy — the single-generation discovery heap
 * retainer `MemoryMonitor` cannot free (documented in `AnalysisHeapGuard`,
 * #2594). Multiplying the estimate by this factor triggers the flush early
 * enough that peak (accumulator + transform copy) stays under the threshold.
 */
export const RUST_FLUSH_PEAK_COPY_MULTIPLIER = 2;
