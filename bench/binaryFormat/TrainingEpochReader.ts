/**
 * TrainingEpochReader.ts — Baseline benchmark for the per-record
 * `seekSync` + `readSync` pattern used by `src/architecture/training/
 * TrainingEpoch.ts` (Issue #2418).
 *
 * Goal: capture the wall-time / throughput of the existing Deno sync
 * reader over a representative `.bin` corpus so the cost/benefit of
 * delegating to the native `training_bin_stream` reader (NEAT-AI-core
 * PRs #28/#29) can be assessed before any code change.
 *
 * Mirrors the production hot path: open file, seekSync to a record
 * offset, readSync into a pre-allocated Uint8Array, copy halves into
 * observation/target Float32 buffers. We do not run activation here —
 * the goal is to measure the I/O floor only.
 *
 * Run with:
 *   deno run --allow-read bench/binaryFormat/TrainingEpochReader.ts
 *
 * Generate the fixture first (3.9 GB) via:
 *   deno run --allow-read --allow-write bench/binaryFormat/Generate.ts
 */

import { binaryFilePath, numObservations, numOutputs } from "./Constants.ts";

const BYTES_PER_RECORD = (numObservations + numOutputs) * 4;

interface PassResult {
  records: number;
  bytes: number;
  millis: number;
}

function sequentialPass(filePath: string, recordCount: number): PassResult {
  const file = Deno.openSync(filePath, { read: true });
  const recordBuffer = new Uint8Array(BYTES_PER_RECORD);
  const recordArray = new Float32Array(recordBuffer.buffer);
  const observationsBuffer = new Float32Array(numObservations);
  const targetsBuffer = new Float32Array(numOutputs);

  let total = 0;
  const start = performance.now();
  try {
    for (let recordIndex = 0; recordIndex < recordCount; recordIndex++) {
      file.seekSync(
        recordIndex * BYTES_PER_RECORD,
        Deno.SeekMode.Start,
      );
      const bytesRead = file.readSync(recordBuffer);
      if (bytesRead === null || bytesRead !== BYTES_PER_RECORD) break;
      observationsBuffer.set(recordArray.subarray(0, numObservations));
      targetsBuffer.set(recordArray.subarray(numObservations));
      total++;
    }
  } finally {
    file.close();
  }
  const millis = performance.now() - start;
  return { records: total, bytes: total * BYTES_PER_RECORD, millis };
}

function randomSamplePass(
  filePath: string,
  fileRecords: number,
  sampleCount: number,
  seed: number,
): PassResult {
  // Deterministic xorshift32 so runs are repeatable.
  let s = seed | 0;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) % fileRecords;
  };
  const indexes = new Uint32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) indexes[i] = next();

  const file = Deno.openSync(filePath, { read: true });
  const recordBuffer = new Uint8Array(BYTES_PER_RECORD);
  const recordArray = new Float32Array(recordBuffer.buffer);
  const observationsBuffer = new Float32Array(numObservations);
  const targetsBuffer = new Float32Array(numOutputs);

  let total = 0;
  const start = performance.now();
  try {
    for (let i = 0; i < indexes.length; i++) {
      file.seekSync(indexes[i] * BYTES_PER_RECORD, Deno.SeekMode.Start);
      const bytesRead = file.readSync(recordBuffer);
      if (bytesRead === null || bytesRead !== BYTES_PER_RECORD) break;
      observationsBuffer.set(recordArray.subarray(0, numObservations));
      targetsBuffer.set(recordArray.subarray(numObservations));
      total++;
    }
  } finally {
    file.close();
  }
  const millis = performance.now() - start;
  return { records: total, bytes: total * BYTES_PER_RECORD, millis };
}

function format(label: string, result: PassResult): void {
  const seconds = result.millis / 1000;
  const recordsPerSec = result.records / seconds;
  const mibPerSec = result.bytes / (1024 * 1024) / seconds;
  console.log(
    `${label.padEnd(28)} ${result.records.toString().padStart(10)} records  ` +
      `${seconds.toFixed(3).padStart(8)} s  ` +
      `${recordsPerSec.toFixed(0).padStart(10)} rec/s  ` +
      `${mibPerSec.toFixed(1).padStart(8)} MiB/s`,
  );
}

const stat = Deno.statSync(binaryFilePath);
const totalRecords = Math.floor(stat.size / BYTES_PER_RECORD);

console.log(
  `\nTrainingEpoch I/O baseline — ${binaryFilePath}\n` +
    `  records=${totalRecords}  obs=${numObservations}  out=${numOutputs}  ` +
    `bytes/record=${BYTES_PER_RECORD}  total=${
      (stat.size / (1024 * 1024 * 1024)).toFixed(2)
    } GiB\n`,
);

// Three warm-up + measured passes per pattern.
const sequentialRuns: PassResult[] = [];
for (let i = 0; i < 3; i++) {
  sequentialRuns.push(sequentialPass(binaryFilePath, totalRecords));
}

const sampleSize = Math.min(200_000, totalRecords);
const randomRuns: PassResult[] = [];
for (let i = 0; i < 3; i++) {
  randomRuns.push(
    randomSamplePass(binaryFilePath, totalRecords, sampleSize, 0x1234_5678 + i),
  );
}

console.log("Pattern                      records         time  throughput");
sequentialRuns.forEach((r, i) => format(`sequential seekSync run ${i + 1}`, r));
randomRuns.forEach((r, i) => format(`random sample seekSync ${i + 1}`, r));

const avg = (rs: PassResult[]) =>
  rs.reduce((a, r) => a + r.millis, 0) / rs.length;
console.log(
  `\nMean wall-clock time:` +
    `\n  sequential pass over ${totalRecords} records : ${
      avg(sequentialRuns).toFixed(1)
    } ms` +
    `\n  random sample of ${sampleSize} records       : ${
      avg(randomRuns).toFixed(1)
    } ms`,
);
