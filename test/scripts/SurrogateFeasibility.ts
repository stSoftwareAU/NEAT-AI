/**
 * Issue #3930: the Stage 1 harness end to end — what it refuses to study, what
 * it reports, and what it concludes.
 *
 * The study is built to be believed, so the tests that matter are the ones
 * that check it refuses to produce a believable-looking table it has not
 * earned: an archive of approximate scores, a mismatched descriptor version,
 * an unstamped provenance, and a gate that passes only when a model really
 * beat the baseline.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import type { EvaluationArchiveRecord } from "@archive/EvaluationArchiveFormat.ts";
import { EVALUATION_DESCRIPTOR_LENGTH } from "@archive/EvaluationDescriptor.ts";
import {
  assertStudyable,
  markdownReport,
  parseProvenance,
  runFeasibilityStudy,
} from "../../scripts/surrogate_feasibility.ts";

/** A deterministic generator, so the whole study is reproducible. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * An archive of `runs` runs, each a chain of parent → child so that lineage,
 * run and parent score are all real rather than stubbed.
 */
function buildArchive(runs: number, perRun: number): EvaluationArchiveRecord[] {
  const next = rng(3930);
  const records: EvaluationArchiveRecord[] = [];
  for (let run = 0; run < runs; run++) {
    let previous: string | undefined;
    for (let i = 0; i < perRun; i++) {
      const uuid = `r${run}-c${i}`;
      const neurons = 8 + next() * 20;
      const synapses = 20 + next() * 60;
      const descriptor = new Array<number>(EVALUATION_DESCRIPTOR_LENGTH)
        .fill(0);
      descriptor[0] = neurons;
      descriptor[5] = synapses;
      descriptor[6] = 2 + next() * 3;
      records.push({
        descriptorVersion: 1,
        runId: `run-${run}`,
        generation: i + 1,
        uuid,
        parents: previous === undefined ? [] : [previous],
        operators: [],
        score: -(neurons * 0.01 + synapses * 0.002) + next() * 0.001,
        fidelity: 1,
        recordedAt: "2026-09-10T00:00:00.000Z",
        descriptor,
      });
      previous = uuid;
    }
  }
  return records;
}

Deno.test("surrogate feasibility - provenance is required and validated", () => {
  assertEquals(parseProvenance("production"), "production");
  assertEquals(parseProvenance("container-run"), "container-run");
  assertThrows(() => parseProvenance(undefined), Error, "--provenance");
  assertThrows(() => parseProvenance("guess"), Error, "must be one of");
});

Deno.test("surrogate feasibility - an archive that cannot support a study is refused", () => {
  const records = buildArchive(2, 8);
  assertStudyable(records);

  assertThrows(
    () => assertStudyable(records.slice(0, 4)),
    Error,
    "at least",
  );
  assertThrows(
    () =>
      assertStudyable([
        { ...records[0], fidelity: 0.25 },
        ...records.slice(1),
      ]),
    Error,
    "another approximation",
  );
  assertThrows(
    () =>
      assertStudyable([
        { ...records[0], descriptorVersion: 2 },
        ...records.slice(1),
      ]),
    Error,
    "descriptor version",
  );
  assertThrows(
    () =>
      assertStudyable([
        { ...records[0], score: Number.NaN },
        ...records.slice(1),
      ]),
    Error,
    "non-finite",
  );
});

Deno.test("surrogate feasibility - the study reports both splits, every family and the baseline", () => {
  const report = runFeasibilityStudy({
    records: buildArchive(4, 12),
    archivePath: "memory://test",
    provenance: "synthetic",
    acceptGap: 1e-4,
  });
  assertEquals(report.splits.map((split) => split.mode), ["lineage", "run"]);
  for (const split of report.splits) {
    assertEquals(split.results.map((result) => result.name), [
      "quadratic-polynomial",
      "rbf-interpolation",
      "gaussian-process",
      "gradient-boosted-trees",
      "parent-score-baseline",
    ]);
    assert(split.rule.length > 0, "every split states its rule");
    for (const result of split.results) {
      // Every family must be reported at the margin the issue names, even
      // when the band held no pair — a missing row is not a result.
      assertEquals(result.bands.length, report.bands.length);
    }
  }
  assert(
    report.lineageCoverage > 0.5,
    `this archive links parents: ${report.lineageCoverage}`,
  );
  assert(report.killGate.reasons.length > 0, "the gate always states why");
});

Deno.test("surrogate feasibility - a lineage-linked archive splits by lineage, not by run", () => {
  const report = runFeasibilityStudy({
    records: buildArchive(3, 10),
    archivePath: "memory://test",
    provenance: "synthetic",
  });
  const lineage = report.splits[0];
  const run = report.splits[1];
  // Each run here is one unbroken parent chain, so the two splits agree on
  // the number of groups — which is the check that lineage tracking is real
  // rather than that every creature became its own group.
  assertEquals(lineage.groups, 3);
  assertEquals(run.groups, 3);
  assertEquals(lineage.folds, 3);
});

Deno.test("surrogate feasibility - an archive with no parent links cannot decide the gate", () => {
  const orphaned = buildArchive(3, 10).map((record) => ({
    ...record,
    parents: [],
  }));
  const report = runFeasibilityStudy({
    records: orphaned,
    archivePath: "memory://test",
    provenance: "container-run",
  });
  assertEquals(report.lineageCoverage, 0);
  assertEquals(report.killGate.passed, false);
  assertEquals(report.killGate.best, null);
  assert(
    report.killGate.reasons.join(" ").includes("undecidable"),
    "an archive without parents makes the gate undecidable, not failed",
  );
  const markdown = markdownReport(report);
  assert(
    markdown.includes("not** a measured negative"),
    "the report must not read an undecidable gate as a measured negative",
  );
});

Deno.test("surrogate feasibility - the Markdown report carries the stamps that make it readable", () => {
  const report = runFeasibilityStudy({
    records: buildArchive(4, 12),
    archivePath: "/tmp/evaluations.jsonl",
    provenance: "container-run",
    acceptGap: 1e-4,
  });
  const markdown = markdownReport(report);
  for (
    const stamp of [
      "container-run",
      "/tmp/evaluations.jsonl",
      "descriptor v1",
      "Held out by lineage",
      "Held out by run",
      "parent-score-baseline",
      "1e-4 (cumulative)",
      "## Kill gate",
    ]
  ) {
    assert(markdown.includes(stamp), `the report must state ${stamp}`);
  }
  assert(
    markdown.includes("PASS") || markdown.includes("FAIL"),
    "the report must state an explicit verdict",
  );
});
