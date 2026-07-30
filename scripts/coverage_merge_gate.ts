#!/usr/bin/env -S deno run --allow-read
/**
 * Decide whether the sharded coverage merge may proceed — and fail loud when
 * coverage has gone missing (Issue #3550).
 *
 * Background: each shard writes a partial coverage directory and uploads it as
 * an artifact. `actions/upload-artifact` defaults to
 * `include-hidden-files: false`, so the old dot-prefixed `.coverage-<shard>/`
 * directory was silently dropped and never reached the merge job. The merge
 * step then found an empty glob, printed "skipping coverage report", and exited
 * 0 — a missing input reported as a clean run.
 *
 * The rule: if any shard uploaded a status file it ran tests, so at least one
 * coverage directory MUST be present. An empty glob in that case is a defect
 * and exits non-zero. Only when nothing at all was uploaded (every shard
 * crashed) does this step skip — the shard-status gate reports that failure.
 *
 * The pure decision function is unit-tested in `test/ci/CoverageMergeGate.ts`;
 * the CLI wrapper is invoked from `.github/workflows/coverage.yaml`.
 *
 * CLI usage — scans a directory (default `.`) and exits 1 on a lost-coverage
 * defect:
 *
 *   deno run --allow-read scripts/coverage_merge_gate.ts [--dir=.]
 */

/** Discovered merge inputs in the workspace. */
export interface CoverageMergeInputs {
  /** Non-hidden per-shard coverage directories, e.g. `coverage-3`. */
  coverageDirs: string[];
  /** Per-shard status markers, e.g. `shard-status-3.txt`. */
  statusFiles: string[];
}

/** Outcome of the gate. */
export interface CoverageMergeGateResult {
  /** `merge` — run `deno coverage`; `skip` — nothing ran; `fail` — defect. */
  status: "merge" | "skip" | "fail";
  /** Human-readable explanation printed by the CLI. */
  message: string;
}

/**
 * A shard coverage directory. Dot-prefixed names are deliberately rejected:
 * a hidden directory is dropped by `actions/upload-artifact`, so it can never
 * be a legitimate merge input.
 */
export function isCoverageShardDir(name: string): boolean {
  return /^coverage-\d+$/.test(name);
}

/** A per-shard status marker written by the shard job. */
export function isShardStatusFile(name: string): boolean {
  return /^shard-status-\d+\.txt$/.test(name);
}

/** Scan `dir` for the merge inputs, sorted for stable reporting. */
export async function scanCoverageMergeInputs(
  dir: string,
): Promise<CoverageMergeInputs> {
  const coverageDirs: string[] = [];
  const statusFiles: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isDirectory && isCoverageShardDir(entry.name)) {
      coverageDirs.push(entry.name);
    } else if (entry.isFile && isShardStatusFile(entry.name)) {
      statusFiles.push(entry.name);
    }
  }
  coverageDirs.sort();
  statusFiles.sort();
  return { coverageDirs, statusFiles };
}

/**
 * Decide the merge outcome. Missing coverage after any shard reported a status
 * is a defect, never a quiet skip.
 */
export function evaluateCoverageMergeGate(
  inputs: CoverageMergeInputs,
): CoverageMergeGateResult {
  const { coverageDirs, statusFiles } = inputs;
  if (coverageDirs.length > 0) {
    return {
      status: "merge",
      message: `Merging coverage from: ${coverageDirs.join(" ")}`,
    };
  }
  if (statusFiles.length > 0) {
    return {
      status: "fail",
      message:
        `❌ ${statusFiles.length} shard(s) uploaded a shard-status marker but no ` +
        `coverage-<shard>/ directory reached the merge job. Coverage would be ` +
        `silently lost — check that the shard artifact upload includes the ` +
        `coverage directory and that it is not a hidden (dot-prefixed) path.`,
    };
  }
  return {
    status: "skip",
    message:
      "No shard artifacts of any kind were uploaded; the shard-status gate " +
      "reports this failure. Skipping the coverage report.",
  };
}

if (import.meta.main) {
  const dirArg = Deno.args.find((a) => a.startsWith("--dir="));
  const dir = dirArg ? dirArg.slice("--dir=".length) : ".";
  const result = evaluateCoverageMergeGate(await scanCoverageMergeInputs(dir));
  console.log(result.message);
  if (result.status === "fail") Deno.exit(1);
  // `skip` is reported to the workflow via a distinct exit code so the step can
  // tell "nothing to merge" apart from "merge these dirs" without re-globbing.
  if (result.status === "skip") Deno.exit(2);
}
