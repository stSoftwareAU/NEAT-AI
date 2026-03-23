//! Binary training data reader for NEAT-AI.
//!
//! Reads packed `f32` binary files (`.bin`) produced by the TypeScript `DataSet`
//! module. Each record contains `num_inputs + num_outputs` little-endian `f32`
//! values (4 bytes each), packed contiguously. Files within a directory are read
//! in numeric order (e.g., `0.bin`, `1.bin`, …).
//!
//! Provides both a streaming iterator interface (low memory) and a batch reader
//! for loading all records into memory.
//!
//! Issue #1966 – Implement binary training data reader in Rust.

use std::fs;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// A single training record with separate input and output slices.
#[derive(Debug, Clone, PartialEq)]
pub struct TrainingRecord {
    /// Input values for this record.
    pub inputs: Vec<f32>,
    /// Expected output values for this record.
    pub outputs: Vec<f32>,
}

/// Configuration for reading binary training data.
#[derive(Debug, Clone)]
pub struct TrainingDataConfig {
    /// Number of input neurons.
    pub num_inputs: usize,
    /// Number of output neurons.
    pub num_outputs: usize,
}

impl TrainingDataConfig {
    /// Create a new configuration.
    pub fn new(num_inputs: usize, num_outputs: usize) -> Self {
        Self {
            num_inputs,
            num_outputs,
        }
    }

    /// Number of f32 values per record.
    pub fn values_per_record(&self) -> usize {
        self.num_inputs + self.num_outputs
    }

    /// Byte size of a single record.
    pub fn bytes_per_record(&self) -> usize {
        self.values_per_record() * std::mem::size_of::<f32>()
    }
}

/// Errors that can occur when reading training data.
#[derive(Debug)]
pub enum TrainingDataError {
    /// An I/O error occurred.
    Io(io::Error),
    /// A file's size is not an exact multiple of the record size.
    InvalidFileSize {
        path: PathBuf,
        file_size: u64,
        record_size: usize,
    },
    /// The configuration specifies zero inputs or zero outputs.
    InvalidConfig { message: String },
}

impl std::fmt::Display for TrainingDataError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TrainingDataError::Io(err) => write!(f, "I/O error: {err}"),
            TrainingDataError::InvalidFileSize {
                path,
                file_size,
                record_size,
            } => {
                write!(
                    f,
                    "File {} has size {file_size} bytes which is not a multiple of record size {record_size}",
                    path.display()
                )
            }
            TrainingDataError::InvalidConfig { message } => {
                write!(f, "Invalid configuration: {message}")
            }
        }
    }
}

impl std::error::Error for TrainingDataError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            TrainingDataError::Io(err) => Some(err),
            _ => None,
        }
    }
}

impl From<io::Error> for TrainingDataError {
    fn from(err: io::Error) -> Self {
        TrainingDataError::Io(err)
    }
}

/// Find all `.bin` files in a directory and return them sorted in numeric order.
///
/// Files are expected to be named with numeric stems (e.g., `0.bin`, `1.bin`).
/// Files whose stems are not valid numbers are sorted after numeric files
/// in lexicographic order.
pub fn find_bin_files(dir: &Path) -> Result<Vec<PathBuf>, TrainingDataError> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut bin_files: Vec<PathBuf> = Vec::new();

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                if ext == "bin" {
                    bin_files.push(path);
                }
            }
        }
    }

    // Sort numerically by file stem, falling back to lexicographic order.
    bin_files.sort_by(|a, b| {
        let a_num = a
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse::<u64>().ok());
        let b_num = b
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse::<u64>().ok());

        match (a_num, b_num) {
            (Some(an), Some(bn)) => an.cmp(&bn),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.cmp(b),
        }
    });

    Ok(bin_files)
}

/// Validate that a file's size is an exact multiple of the record size.
fn validate_file_size(path: &Path, config: &TrainingDataConfig) -> Result<u64, TrainingDataError> {
    let metadata = fs::metadata(path)?;
    let file_size = metadata.len();
    let record_size = config.bytes_per_record();

    if record_size > 0 && file_size % (record_size as u64) != 0 {
        return Err(TrainingDataError::InvalidFileSize {
            path: path.to_path_buf(),
            file_size,
            record_size,
        });
    }

    Ok(file_size)
}

/// Validate the training data configuration.
fn validate_config(config: &TrainingDataConfig) -> Result<(), TrainingDataError> {
    if config.num_inputs == 0 {
        return Err(TrainingDataError::InvalidConfig {
            message: "num_inputs must be greater than zero".to_string(),
        });
    }
    if config.num_outputs == 0 {
        return Err(TrainingDataError::InvalidConfig {
            message: "num_outputs must be greater than zero".to_string(),
        });
    }
    Ok(())
}

/// Parse a byte buffer into f32 values using little-endian byte order.
///
/// The buffer length must be an exact multiple of 4.
fn parse_f32_values(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

/// Parse a byte buffer into a single `TrainingRecord`.
fn parse_record(bytes: &[u8], config: &TrainingDataConfig) -> TrainingRecord {
    let values = parse_f32_values(bytes);
    let inputs = values[..config.num_inputs].to_vec();
    let outputs = values[config.num_inputs..].to_vec();
    TrainingRecord { inputs, outputs }
}

// ---------------------------------------------------------------------------
// Batch reader
// ---------------------------------------------------------------------------

/// Load all training records from a single `.bin` file into memory.
pub fn read_file(
    path: &Path,
    config: &TrainingDataConfig,
) -> Result<Vec<TrainingRecord>, TrainingDataError> {
    validate_config(config)?;
    validate_file_size(path, config)?;

    let data = fs::read(path)?;
    let record_size = config.bytes_per_record();

    if data.is_empty() {
        return Ok(Vec::new());
    }

    let records: Vec<TrainingRecord> = data
        .chunks_exact(record_size)
        .map(|chunk| parse_record(chunk, config))
        .collect();

    Ok(records)
}

/// Load all training records from every `.bin` file in a directory.
///
/// Files are read in numeric order. Returns an empty `Vec` if the directory
/// contains no `.bin` files.
pub fn read_dir(
    dir: &Path,
    config: &TrainingDataConfig,
) -> Result<Vec<TrainingRecord>, TrainingDataError> {
    validate_config(config)?;
    let files = find_bin_files(dir)?;
    let mut all_records: Vec<TrainingRecord> = Vec::new();

    for file_path in &files {
        let records = read_file(file_path, config)?;
        all_records.extend(records);
    }

    Ok(all_records)
}

// ---------------------------------------------------------------------------
// Streaming iterator
// ---------------------------------------------------------------------------

/// A streaming iterator that yields one `TrainingRecord` at a time across
/// multiple `.bin` files, keeping memory usage low.
pub struct TrainingDataIterator {
    config: TrainingDataConfig,
    files: Vec<PathBuf>,
    current_file_index: usize,
    current_reader: Option<io::BufReader<fs::File>>,
    record_buffer: Vec<u8>,
    /// Number of records remaining in the current file.
    records_remaining: u64,
}

impl TrainingDataIterator {
    /// Create a new streaming iterator over all `.bin` files in a directory.
    pub fn new(dir: &Path, config: TrainingDataConfig) -> Result<Self, TrainingDataError> {
        validate_config(&config)?;
        let files = find_bin_files(dir)?;
        let record_buffer = vec![0u8; config.bytes_per_record()];

        let mut iter = Self {
            config,
            files,
            current_file_index: 0,
            current_reader: None,
            record_buffer,
            records_remaining: 0,
        };

        iter.open_next_file()?;
        Ok(iter)
    }

    /// Open the next file in the list, if any.
    fn open_next_file(&mut self) -> Result<bool, TrainingDataError> {
        while self.current_file_index < self.files.len() {
            let path = &self.files[self.current_file_index];
            let file_size = validate_file_size(path, &self.config)?;
            self.current_file_index += 1;

            let record_size = self.config.bytes_per_record() as u64;
            if file_size == 0 {
                continue;
            }

            let file = fs::File::open(path)?;
            self.current_reader = Some(io::BufReader::new(file));
            self.records_remaining = file_size / record_size;
            return Ok(true);
        }

        self.current_reader = None;
        self.records_remaining = 0;
        Ok(false)
    }

    /// Read the next record, returning `None` when all files are exhausted.
    pub fn next_record(&mut self) -> Result<Option<TrainingRecord>, TrainingDataError> {
        loop {
            if self.records_remaining > 0 {
                if let Some(reader) = &mut self.current_reader {
                    reader.read_exact(&mut self.record_buffer)?;
                    self.records_remaining -= 1;
                    return Ok(Some(parse_record(&self.record_buffer, &self.config)));
                }
            }

            if !self.open_next_file()? {
                return Ok(None);
            }
        }
    }

    /// Count the total number of records across all files without reading data.
    ///
    /// This creates a fresh scan of the directory — it does not consume the
    /// iterator.
    pub fn count_records(dir: &Path, config: &TrainingDataConfig) -> Result<u64, TrainingDataError> {
        validate_config(config)?;
        let files = find_bin_files(dir)?;
        let record_size = config.bytes_per_record() as u64;
        let mut total: u64 = 0;

        for path in &files {
            let file_size = validate_file_size(path, config)?;
            total += file_size / record_size;
        }

        Ok(total)
    }
}

/// Seeking record reader for random-access within a single file.
pub struct SeekingRecordReader {
    config: TrainingDataConfig,
    file: fs::File,
    record_buffer: Vec<u8>,
    total_records: u64,
}

impl SeekingRecordReader {
    /// Open a single `.bin` file for random-access record reading.
    pub fn open(path: &Path, config: TrainingDataConfig) -> Result<Self, TrainingDataError> {
        validate_config(&config)?;
        let file_size = validate_file_size(path, &config)?;
        let record_size = config.bytes_per_record() as u64;
        let total_records = if record_size > 0 {
            file_size / record_size
        } else {
            0
        };

        let file = fs::File::open(path)?;
        let record_buffer = vec![0u8; config.bytes_per_record()];

        Ok(Self {
            config,
            file,
            record_buffer,
            total_records,
        })
    }

    /// Total number of records in this file.
    pub fn total_records(&self) -> u64 {
        self.total_records
    }

    /// Read a specific record by index (zero-based).
    pub fn read_record(&mut self, index: u64) -> Result<TrainingRecord, TrainingDataError> {
        let offset = index * self.config.bytes_per_record() as u64;
        self.file.seek(SeekFrom::Start(offset))?;
        self.file.read_exact(&mut self.record_buffer)?;
        Ok(parse_record(&self.record_buffer, &self.config))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Helper: write f32 values as little-endian bytes to a file.
    fn write_f32_file(path: &Path, values: &[f32]) {
        let mut file = fs::File::create(path).expect("failed to create test file");
        for &v in values {
            file.write_all(&v.to_le_bytes())
                .expect("failed to write value");
        }
    }

    /// Helper: create a temporary directory with `.bin` files.
    fn create_test_dir(file_data: &[(&str, &[f32])]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("failed to create temp dir");
        for &(name, values) in file_data {
            let path = dir.path().join(name);
            write_f32_file(&path, values);
        }
        dir
    }

    // -- TrainingDataConfig ---------------------------------------------------

    #[test]
    fn config_calculates_values_and_bytes_per_record() {
        let config = TrainingDataConfig::new(3, 2);
        assert_eq!(config.values_per_record(), 5);
        assert_eq!(config.bytes_per_record(), 20);
    }

    // -- find_bin_files -------------------------------------------------------

    #[test]
    fn find_bin_files_returns_empty_for_nonexistent_dir() {
        let result = find_bin_files(Path::new("/nonexistent/path/unlikely_to_exist"));
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn find_bin_files_returns_empty_for_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let files = find_bin_files(dir.path()).unwrap();
        assert!(files.is_empty());
    }

    #[test]
    fn find_bin_files_sorts_numerically() {
        let dir = tempfile::tempdir().unwrap();
        // Create files in non-numeric order.
        for name in &["10.bin", "2.bin", "0.bin", "1.bin"] {
            fs::write(dir.path().join(name), b"").unwrap();
        }
        // Create a non-bin file that should be excluded.
        fs::write(dir.path().join("readme.txt"), b"ignore").unwrap();

        let files = find_bin_files(dir.path()).unwrap();
        let stems: Vec<&str> = files
            .iter()
            .map(|p| p.file_stem().unwrap().to_str().unwrap())
            .collect();
        assert_eq!(stems, vec!["0", "1", "2", "10"]);
    }

    #[test]
    fn find_bin_files_ignores_non_bin_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("data.json"), b"{}").unwrap();
        fs::write(dir.path().join("0.bin"), b"").unwrap();

        let files = find_bin_files(dir.path()).unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].file_name().unwrap().to_str().unwrap() == "0.bin");
    }

    // -- validate_file_size ---------------------------------------------------

    #[test]
    fn validate_file_size_accepts_exact_multiple() {
        let config = TrainingDataConfig::new(2, 1); // 12 bytes per record
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("0.bin");
        write_f32_file(&path, &[1.0, 2.0, 3.0]); // 12 bytes = 1 record

        let result = validate_file_size(&path, &config);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 12);
    }

    #[test]
    fn validate_file_size_rejects_non_multiple() {
        let config = TrainingDataConfig::new(2, 1); // 12 bytes per record
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.bin");
        // Write 10 bytes (not a multiple of 12).
        fs::write(&path, &[0u8; 10]).unwrap();

        let result = validate_file_size(&path, &config);
        assert!(result.is_err());
        match result.unwrap_err() {
            TrainingDataError::InvalidFileSize {
                file_size,
                record_size,
                ..
            } => {
                assert_eq!(file_size, 10);
                assert_eq!(record_size, 12);
            }
            other => panic!("Expected InvalidFileSize, got: {other:?}"),
        }
    }

    // -- validate_config ------------------------------------------------------

    #[test]
    fn validate_config_rejects_zero_inputs() {
        let result = validate_config(&TrainingDataConfig::new(0, 1));
        assert!(result.is_err());
    }

    #[test]
    fn validate_config_rejects_zero_outputs() {
        let result = validate_config(&TrainingDataConfig::new(1, 0));
        assert!(result.is_err());
    }

    // -- parse_f32_values -----------------------------------------------------

    #[test]
    fn parse_f32_values_produces_correct_floats() {
        let values: Vec<f32> = vec![1.0, -2.5, 3.14, 0.0];
        let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
        let parsed = parse_f32_values(&bytes);
        assert_eq!(parsed, values);
    }

    #[test]
    fn parse_f32_values_handles_empty_input() {
        let parsed = parse_f32_values(&[]);
        assert!(parsed.is_empty());
    }

    // -- parse_record ---------------------------------------------------------

    #[test]
    fn parse_record_splits_inputs_and_outputs() {
        let config = TrainingDataConfig::new(2, 1);
        let values: Vec<f32> = vec![0.5, -0.5, 1.0];
        let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
        let record = parse_record(&bytes, &config);
        assert_eq!(record.inputs, vec![0.5, -0.5]);
        assert_eq!(record.outputs, vec![1.0]);
    }

    // -- read_file (batch) ----------------------------------------------------

    #[test]
    fn read_file_loads_all_records() {
        let config = TrainingDataConfig::new(2, 1);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("0.bin");
        // Two records: [1.0, 2.0, 3.0] and [4.0, 5.0, 6.0]
        write_f32_file(&path, &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);

        let records = read_file(&path, &config).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].inputs, vec![1.0, 2.0]);
        assert_eq!(records[0].outputs, vec![3.0]);
        assert_eq!(records[1].inputs, vec![4.0, 5.0]);
        assert_eq!(records[1].outputs, vec![6.0]);
    }

    #[test]
    fn read_file_handles_empty_file() {
        let config = TrainingDataConfig::new(2, 1);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.bin");
        fs::write(&path, b"").unwrap();

        let records = read_file(&path, &config).unwrap();
        assert!(records.is_empty());
    }

    #[test]
    fn read_file_single_record() {
        let config = TrainingDataConfig::new(3, 2);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("0.bin");
        write_f32_file(&path, &[0.1, 0.2, 0.3, 0.9, 0.8]);

        let records = read_file(&path, &config).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].inputs, vec![0.1, 0.2, 0.3]);
        assert_eq!(records[0].outputs, vec![0.9, 0.8]);
    }

    #[test]
    fn read_file_rejects_invalid_config() {
        let config = TrainingDataConfig::new(0, 1);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("0.bin");
        fs::write(&path, b"").unwrap();

        let result = read_file(&path, &config);
        assert!(result.is_err());
    }

    // -- read_dir (batch) -----------------------------------------------------

    #[test]
    fn read_dir_loads_all_files_in_numeric_order() {
        let config = TrainingDataConfig::new(1, 1);
        // File 0: one record [1.0, 10.0]
        // File 1: two records [2.0, 20.0] [3.0, 30.0]
        let dir = create_test_dir(&[
            ("0.bin", &[1.0, 10.0]),
            ("1.bin", &[2.0, 20.0, 3.0, 30.0]),
        ]);

        let records = read_dir(dir.path(), &config).unwrap();
        assert_eq!(records.len(), 3);
        assert_eq!(records[0].inputs, vec![1.0]);
        assert_eq!(records[0].outputs, vec![10.0]);
        assert_eq!(records[1].inputs, vec![2.0]);
        assert_eq!(records[1].outputs, vec![20.0]);
        assert_eq!(records[2].inputs, vec![3.0]);
        assert_eq!(records[2].outputs, vec![30.0]);
    }

    #[test]
    fn read_dir_handles_empty_directory() {
        let dir = tempfile::tempdir().unwrap();
        let config = TrainingDataConfig::new(2, 1);
        let records = read_dir(dir.path(), &config).unwrap();
        assert!(records.is_empty());
    }

    #[test]
    fn read_dir_handles_nonexistent_directory() {
        let config = TrainingDataConfig::new(2, 1);
        let records = read_dir(Path::new("/nonexistent/unlikely_path"), &config).unwrap();
        assert!(records.is_empty());
    }

    // -- TrainingDataIterator (streaming) -------------------------------------

    #[test]
    fn iterator_streams_records_across_files() {
        let config = TrainingDataConfig::new(1, 1);
        let dir = create_test_dir(&[
            ("0.bin", &[1.0, 10.0]),
            ("1.bin", &[2.0, 20.0, 3.0, 30.0]),
        ]);

        let mut iter = TrainingDataIterator::new(dir.path(), config).unwrap();

        let r1 = iter.next_record().unwrap().unwrap();
        assert_eq!(r1.inputs, vec![1.0]);
        assert_eq!(r1.outputs, vec![10.0]);

        let r2 = iter.next_record().unwrap().unwrap();
        assert_eq!(r2.inputs, vec![2.0]);
        assert_eq!(r2.outputs, vec![20.0]);

        let r3 = iter.next_record().unwrap().unwrap();
        assert_eq!(r3.inputs, vec![3.0]);
        assert_eq!(r3.outputs, vec![30.0]);

        assert!(iter.next_record().unwrap().is_none());
    }

    #[test]
    fn iterator_handles_empty_directory() {
        let dir = tempfile::tempdir().unwrap();
        let config = TrainingDataConfig::new(2, 1);
        let mut iter = TrainingDataIterator::new(dir.path(), config).unwrap();
        assert!(iter.next_record().unwrap().is_none());
    }

    #[test]
    fn iterator_skips_empty_files() {
        let config = TrainingDataConfig::new(1, 1);
        let dir = tempfile::tempdir().unwrap();
        // File 0 is empty, file 1 has one record.
        fs::write(dir.path().join("0.bin"), b"").unwrap();
        write_f32_file(&dir.path().join("1.bin"), &[5.0, 50.0]);

        let mut iter = TrainingDataIterator::new(dir.path(), config).unwrap();
        let r = iter.next_record().unwrap().unwrap();
        assert_eq!(r.inputs, vec![5.0]);
        assert_eq!(r.outputs, vec![50.0]);
        assert!(iter.next_record().unwrap().is_none());
    }

    #[test]
    fn count_records_returns_total() {
        let config = TrainingDataConfig::new(1, 1);
        let dir = create_test_dir(&[
            ("0.bin", &[1.0, 10.0]),
            ("1.bin", &[2.0, 20.0, 3.0, 30.0]),
        ]);

        let total = TrainingDataIterator::count_records(dir.path(), &config).unwrap();
        assert_eq!(total, 3);
    }

    #[test]
    fn count_records_returns_zero_for_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let config = TrainingDataConfig::new(2, 1);
        let total = TrainingDataIterator::count_records(dir.path(), &config).unwrap();
        assert_eq!(total, 0);
    }

    // -- SeekingRecordReader (random access) ----------------------------------

    #[test]
    fn seeking_reader_reads_records_by_index() {
        let config = TrainingDataConfig::new(2, 1);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.bin");
        // Three records: [1,2,3], [4,5,6], [7,8,9]
        write_f32_file(&path, &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]);

        let mut reader = SeekingRecordReader::open(&path, config).unwrap();
        assert_eq!(reader.total_records(), 3);

        // Read out of order.
        let r2 = reader.read_record(2).unwrap();
        assert_eq!(r2.inputs, vec![7.0, 8.0]);
        assert_eq!(r2.outputs, vec![9.0]);

        let r0 = reader.read_record(0).unwrap();
        assert_eq!(r0.inputs, vec![1.0, 2.0]);
        assert_eq!(r0.outputs, vec![3.0]);

        let r1 = reader.read_record(1).unwrap();
        assert_eq!(r1.inputs, vec![4.0, 5.0]);
        assert_eq!(r1.outputs, vec![6.0]);
    }

    // -- Large file test ------------------------------------------------------

    #[test]
    fn read_large_file_with_many_records() {
        let config = TrainingDataConfig::new(4, 2);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("large.bin");

        // Generate 1000 records.
        let num_records = 1000;
        let values_per_record = config.values_per_record();
        let mut all_values: Vec<f32> = Vec::with_capacity(num_records * values_per_record);
        for i in 0..num_records {
            for j in 0..values_per_record {
                all_values.push((i * values_per_record + j) as f32);
            }
        }
        write_f32_file(&path, &all_values);

        let records = read_file(&path, &config).unwrap();
        assert_eq!(records.len(), num_records);

        // Verify first and last records.
        assert_eq!(records[0].inputs, vec![0.0, 1.0, 2.0, 3.0]);
        assert_eq!(records[0].outputs, vec![4.0, 5.0]);

        let last = &records[num_records - 1];
        let base = ((num_records - 1) * values_per_record) as f32;
        assert_eq!(last.inputs, vec![base, base + 1.0, base + 2.0, base + 3.0]);
        assert_eq!(last.outputs, vec![base + 4.0, base + 5.0]);
    }

    // -- Consistency: batch vs streaming --------------------------------------

    #[test]
    fn batch_and_streaming_produce_identical_results() {
        let config = TrainingDataConfig::new(2, 2);
        let dir = create_test_dir(&[
            ("0.bin", &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]),
            ("1.bin", &[9.0, 10.0, 11.0, 12.0]),
        ]);

        // Batch read.
        let batch = read_dir(dir.path(), &config).unwrap();

        // Streaming read.
        let mut iter = TrainingDataIterator::new(dir.path(), config).unwrap();
        let mut streamed: Vec<TrainingRecord> = Vec::new();
        while let Some(record) = iter.next_record().unwrap() {
            streamed.push(record);
        }

        assert_eq!(batch, streamed);
    }

    // -- Byte-level compatibility with TypeScript Float32Array -----------------

    #[test]
    fn byte_level_compatibility_with_typescript_float32array() {
        // Simulate the exact bytes that TypeScript would produce:
        //   const array = new Float32Array([1.5, -2.25, 0.125]);
        //   new Uint8Array(array.buffer)
        //
        // JavaScript TypedArrays use platform byte order which on all modern
        // platforms (x86, ARM) is little-endian — matching our f32::from_le_bytes.
        let expected_values: Vec<f32> = vec![1.5, -2.25, 0.125];
        let bytes: Vec<u8> = expected_values
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();

        let config = TrainingDataConfig::new(2, 1);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("0.bin");
        fs::write(&path, &bytes).unwrap();

        let records = read_file(&path, &config).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].inputs, vec![1.5, -2.25]);
        assert_eq!(records[0].outputs, vec![0.125]);
    }

    // -- Error display --------------------------------------------------------

    #[test]
    fn error_display_messages_are_descriptive() {
        let err = TrainingDataError::InvalidFileSize {
            path: PathBuf::from("test.bin"),
            file_size: 10,
            record_size: 12,
        };
        let msg = format!("{err}");
        assert!(msg.contains("test.bin"));
        assert!(msg.contains("10"));
        assert!(msg.contains("12"));

        let err2 = TrainingDataError::InvalidConfig {
            message: "test error".to_string(),
        };
        let msg2 = format!("{err2}");
        assert!(msg2.contains("test error"));
    }
}
