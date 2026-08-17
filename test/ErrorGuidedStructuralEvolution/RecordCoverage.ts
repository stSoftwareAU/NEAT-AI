/**
 * Tests for the record-phase coverage guard (Issue #3073).
 *
 * These exercise the pure helpers that decide whether discovery analysis runs
 * after a record-phase timeout. They assert on returned values — no I/O, no
 * timing — so they remain stable across implementation changes.
 */

import { assert, assertEquals } from "@std/assert";
import {
  computeRecordCoverage,
  estimateTotalRecords,
  formatRecordCoverage,
  formatRecordThroughputAbort,
  projectRecordCoverageFromThroughput,
  shouldSkipAnalysisForCoverage,
} from "@architecture/ErrorGuidedStructuralEvolution/RecordCoverage.ts";

Deno.test("estimateTotalRecords extrapolates from processed files", () => {
  // GRQ-3 shape: ~110 of 520 files yielded 1766 records -> ~8350 estimated.
  const estimate = estimateTotalRecords(1766, 110, 520);
  assert(
    estimate >= 8000 && estimate <= 8700,
    `expected ~8350, got ${estimate}`,
  );
});

Deno.test("estimateTotalRecords returns recorded count when no files processed", () => {
  // Timed out mid-first-file: cannot extrapolate, assume what we have.
  assertEquals(estimateTotalRecords(50, 0, 10), 50);
});

Deno.test("estimateTotalRecords returns recorded count when all files processed", () => {
  // Complete recording: the count is exact, not an estimate.
  assertEquals(estimateTotalRecords(500, 10, 10), 500);
});

Deno.test("estimateTotalRecords never estimates below recorded count", () => {
  const estimate = estimateTotalRecords(100, 9, 10);
  assert(estimate >= 100, `estimate ${estimate} must be >= recorded 100`);
});

Deno.test("computeRecordCoverage derives fraction within [0,1]", () => {
  const coverage = computeRecordCoverage({
    recordsProcessed: 1766,
    filesProcessed: 110,
    totalFiles: 520,
    timedOut: true,
  });
  assert(coverage.coverageFraction > 0 && coverage.coverageFraction < 1);
  // ~110/520 ≈ 0.21
  assert(
    Math.abs(coverage.coverageFraction - 0.21) < 0.03,
    `expected ~0.21, got ${coverage.coverageFraction}`,
  );
});

Deno.test("shouldSkipAnalysisForCoverage skips a heavily-truncated timeout", () => {
  const coverage = computeRecordCoverage({
    recordsProcessed: 1766,
    filesProcessed: 110,
    totalFiles: 520,
    timedOut: true,
  });
  // Default guard at 50% — 21% coverage must skip.
  assertEquals(shouldSkipAnalysisForCoverage(coverage, 0.5), true);
});

Deno.test("shouldSkipAnalysisForCoverage runs analysis when recording completed", () => {
  const coverage = computeRecordCoverage({
    recordsProcessed: 8350,
    filesProcessed: 520,
    totalFiles: 520,
    timedOut: false,
  });
  assertEquals(shouldSkipAnalysisForCoverage(coverage, 0.5), false);
});

Deno.test("shouldSkipAnalysisForCoverage never skips a non-timeout even if partial", () => {
  // Recording stopped for a non-timeout reason but with low file coverage.
  const coverage = computeRecordCoverage({
    recordsProcessed: 100,
    filesProcessed: 1,
    totalFiles: 520,
    timedOut: false,
  });
  assertEquals(shouldSkipAnalysisForCoverage(coverage, 0.5), false);
});

Deno.test("shouldSkipAnalysisForCoverage runs analysis when coverage clears the bar", () => {
  // 90% file coverage on a timeout — above the 50% threshold, keep analysing.
  const coverage = computeRecordCoverage({
    recordsProcessed: 900,
    filesProcessed: 9,
    totalFiles: 10,
    timedOut: true,
  });
  assertEquals(shouldSkipAnalysisForCoverage(coverage, 0.5), false);
});

Deno.test("shouldSkipAnalysisForCoverage skips when timeout recorded nothing", () => {
  const coverage = computeRecordCoverage({
    recordsProcessed: 0,
    filesProcessed: 0,
    totalFiles: 520,
    timedOut: true,
  });
  assertEquals(shouldSkipAnalysisForCoverage(coverage, 0.5), true);
});

Deno.test("shouldSkipAnalysisForCoverage is disabled at threshold 0", () => {
  const coverage = computeRecordCoverage({
    recordsProcessed: 1,
    filesProcessed: 1,
    totalFiles: 520,
    timedOut: true,
  });
  assertEquals(shouldSkipAnalysisForCoverage(coverage, 0), false);
});

Deno.test("single-file timeout is immune to the guard", () => {
  // Only one file in the dataset: we cannot extrapolate a total, so coverage
  // is treated as full and analysis always runs (matches existing tests that
  // record a single .bin file under a tight timeout).
  const coverage = computeRecordCoverage({
    recordsProcessed: 12,
    filesProcessed: 0,
    totalFiles: 1,
    timedOut: true,
  });
  assertEquals(coverage.coverageFraction, 1);
  assertEquals(shouldSkipAnalysisForCoverage(coverage, 0.5), false);
});

Deno.test("formatRecordCoverage renders records, estimate and percentages", () => {
  const coverage = computeRecordCoverage({
    recordsProcessed: 1766,
    filesProcessed: 110,
    totalFiles: 520,
    timedOut: true,
  });
  const text = formatRecordCoverage(coverage);
  assert(text.includes("1,766"), `missing recorded count: ${text}`);
  assert(text.includes("110/520 files"), `missing file ratio: ${text}`);
  assert(text.includes("% coverage"), `missing coverage percent: ${text}`);
});

Deno.test("projectRecordCoverageFromThroughput waits for warm-up (#4065)", () => {
  const projection = projectRecordCoverageFromThroughput({
    recordsProcessed: 500,
    filesProcessed: 2,
    totalFiles: 520,
    elapsedMs: 10_000,
    remainingMs: 590_000,
    minCoverage: 0.5,
  });
  assertEquals(projection.ready, false);
  assertEquals(projection.cannotReachRequiredCoverage, false);
});

Deno.test("projectRecordCoverageFromThroughput aborts elephant-shaped doom (#4065)", () => {
  // GRQ-25 elephant: ~68 records/sec, 520 files, ~750 records/file at 15%.
  // After 5 files / 60s (~4080 records) with 9 min left, projected coverage
  // stays well under 50%.
  const projection = projectRecordCoverageFromThroughput({
    recordsProcessed: 4080,
    filesProcessed: 5,
    totalFiles: 520,
    elapsedMs: 60_000,
    remainingMs: 540_000,
    minCoverage: 0.5,
  });
  assertEquals(projection.ready, true);
  assertEquals(projection.cannotReachRequiredCoverage, true);
  assert(projection.projectedCoverageFraction < 0.5);
  assert(projection.minutesNeededForRequiredCoverage > 10);
  const text = formatRecordThroughputAbort(projection);
  assert(text.includes("projected"), text);
  assert(text.includes("required 50%"), text);
  assert(text.includes("records/sec"), text);
});

Deno.test("projectRecordCoverageFromThroughput keeps a coverage-clearing rate (#4065)", () => {
  // Fast enough that remaining budget clears 50%.
  const projection = projectRecordCoverageFromThroughput({
    recordsProcessed: 50_000,
    filesProcessed: 100,
    totalFiles: 200,
    elapsedMs: 60_000,
    remainingMs: 240_000,
    minCoverage: 0.5,
  });
  assertEquals(projection.ready, true);
  assertEquals(projection.cannotReachRequiredCoverage, false);
  assert(projection.projectedCoverageFraction >= 0.5);
});
