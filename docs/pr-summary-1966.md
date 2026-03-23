## Summary

Implement a binary training data reader module in the `neat-core` Rust crate that reads packed `f32` `.bin` files produced by the TypeScript `DataSet` module. Closes #1966.

The module provides three reader interfaces:
- **Batch reader** (`read_file`, `read_dir`) — loads all records into memory
- **Streaming iterator** (`TrainingDataIterator`) — yields one record at a time across multiple files, keeping memory low
- **Seeking reader** (`SeekingRecordReader`) — random-access by record index within a single file

Key implementation details:
- Files are discovered via directory scan and sorted in numeric order (0.bin, 1.bin, …)
- Records are parsed using little-endian `f32` byte order, matching JavaScript `Float32Array` on modern platforms
- File sizes are validated to be exact multiples of the record size
- Configuration is flexible with `num_inputs` and `num_outputs` parameters

## Evidence

All 29 new unit tests pass, covering:
- Configuration calculations
- File discovery and numeric sorting
- File size validation (valid and invalid)
- Record parsing with correct input/output splitting
- Batch reading (single file, multi-file, empty, single-record, large 1000-record file)
- Streaming iterator (multi-file, empty directory, empty files)
- Seeking reader (random-access out-of-order reads)
- Byte-level compatibility with TypeScript Float32Array output
- Batch vs streaming consistency check
- Error handling and display messages
- Edge cases: empty directories, nonexistent directories, zero-input/output config rejection

Full quality gate passes: 4870 tests (221 Rust + 4649 Deno), lint, fmt, type-check all clean.

## Test Plan

- `cargo test -p neat-core --lib training_data` — 29 new tests in `neat-core/src/training_data.rs`
- Tests use `tempfile` crate to create temporary directories with generated binary fixtures
- Byte-level compatibility test verifies that Rust `f32::from_le_bytes` produces identical values to TypeScript `Float32Array`
