/**
 * Default number of records to accumulate before flushing discovery data to Rust.
 *
 * This matches the legacy behaviour (4_096 records) that balances IO pressure
 * and memory usage during multi-file discovery runs.
 */
export const DEFAULT_RUST_FLUSH_RECORDS = 4_096;
