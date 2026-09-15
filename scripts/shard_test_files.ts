#!/usr/bin/env -S deno run --allow-read
/**
 * Deterministically partition the `test/**\/*.ts` file list across N CI
 * shards so the coverage workflow can run the suite in parallel matrix jobs
 * (Issue #3173).
 *
 * `deno test` has no native `--shard` flag, so we partition the sorted file
 * list ourselves. Balancing the *number* of files per shard is not the same as
 * balancing their *cost*: an `evolve()` integration suite costs orders of
 * magnitude more than a unit test, so a plain round-robin left one shard
 * running ~7m while the cheapest finished in ~1m15 (Issue #4017). Files are
 * therefore packed longest-processing-time-first over the measured per-file
 * durations in `scripts/test-timings.json`, which the coverage merge job
 * publishes from the JUnit reports it already aggregates.
 *
 * Both plans are deterministic and assign every file exactly once:
 *
 * - **Weighted** — untimed files (new tests, or a first run) are dealt
 *   round-robin first so they stay evenly spread, each charged the median
 *   recorded duration; timed files are then placed heaviest-first onto
 *   whichever shard is currently cheapest. Ties break on the lowest shard
 *   index, so the plan is identical on every runner.
 * - **Round-robin** — the fallback when no timings are available at all:
 *   shard `s` (of `total`) runs every file whose sorted index `i` satisfies
 *   `i % total === s`.
 *
 * CLI usage (all modes read the on-disk `test/` tree, and load
 * `scripts/test-timings.json` when it exists):
 *
 *   # Print this shard's slice, one path per line (fed to `deno test`):
 *   deno run --allow-read scripts/shard_test_files.ts --list --shard=0 --total=8
 *
 *   # Assert every file is covered exactly once across all shards; non-zero
 *   # exit on any gap or duplicate (the CI file-count parity gate):
 *   deno run --allow-read scripts/shard_test_files.ts --verify --total=8
 *
 *   # Show the planned slice size and estimated cost of every shard:
 *   deno run --allow-read scripts/shard_test_files.ts --plan --total=8
 *
 *   # Print the total number of discovered test files:
 *   deno run --allow-read scripts/shard_test_files.ts --count
 */

import { expandGlob } from "@std/fs";
import { relative } from "@std/path";

/**
 * Collect every `*.ts` file under `root` (default `test`), returned as
 * repo-relative POSIX paths, sorted lexicographically. The glob mirrors the
 * `test.include` pattern in `deno.json` (`test/**\/*.ts`) so the sharded runs
 * cover exactly the same set of files as the pre-shard single run.
 */
export async function collectTestFiles(root = "test"): Promise<string[]> {
  const entries = await Array.fromAsync(
    expandGlob(`${root}/**/*.ts`, { includeDirs: false, globstar: true }),
  );
  const files = entries
    .filter((entry) => entry.isFile)
    .map((entry) => relative(Deno.cwd(), entry.path).replaceAll("\\", "/"));
  files.sort();
  return files;
}

function assertShardArgs(total: number, shard: number): void {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`total must be a positive integer, got ${total}`);
  }
  if (!Number.isInteger(shard) || shard < 0 || shard >= total) {
    throw new Error(
      `shard must be an integer in [0, ${total - 1}], got ${shard}`,
    );
  }
}

/** Per-file test cost in seconds, keyed by repo-relative POSIX path. */
export type FileDurations = Readonly<Record<string, number>>;

/** Where the coverage merge job publishes the measured per-file durations. */
export const DEFAULT_TIMINGS_PATH = "scripts/test-timings.json";

/** The recorded cost of `file`, or undefined when it has never been measured. */
function recordedCost(
  file: string,
  timings: FileDurations | undefined,
): number | undefined {
  const value = timings?.[file];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Plan the whole matrix: return one slice per shard, `0 … total-1`.
 *
 * With `timings`, files are packed longest-processing-time-first onto the
 * cheapest shard so wall-clock — not file count — is what gets balanced. Files
 * with no recorded timing keep the historical round-robin placement and are
 * charged the median recorded duration so the packer still accounts for them.
 * Without usable timings the plan is exactly the previous round-robin.
 *
 * Deterministic for a given (files, total, timings): every tie breaks on the
 * lowest shard index, and each slice is returned sorted.
 */
export function planShards(
  files: string[],
  total: number,
  timings?: FileDurations,
): string[][] {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`total must be a positive integer, got ${total}`);
  }
  const shards: string[][] = Array.from({ length: total }, () => []);
  const timed = files.filter((file) =>
    recordedCost(file, timings) !== undefined
  );
  if (timed.length === 0) {
    // No measurements at all — fall back to the stable round-robin.
    files.forEach((file, index) => shards[index % total].push(file));
    return shards;
  }
  const loads = new Array<number>(total).fill(0);
  const nominal = median(timed.map((file) => recordedCost(file, timings)!));
  files
    .filter((file) => recordedCost(file, timings) === undefined)
    .forEach((file, index) => {
      const shard = index % total;
      shards[shard].push(file);
      loads[shard] += nominal;
    });
  const heaviestFirst = [...timed].sort((a, b) => {
    const delta = recordedCost(b, timings)! - recordedCost(a, timings)!;
    return delta !== 0 ? delta : a.localeCompare(b);
  });
  for (const file of heaviestFirst) {
    let cheapest = 0;
    for (let shard = 1; shard < total; shard++) {
      if (loads[shard] < loads[cheapest]) cheapest = shard;
    }
    shards[cheapest].push(file);
    loads[cheapest] += recordedCost(file, timings)!;
  }
  for (const slice of shards) slice.sort();
  return shards;
}

/** Summed recorded cost of a planned slice, in seconds. */
export function shardCost(slice: string[], timings?: FileDurations): number {
  return slice.reduce(
    (sum, file) => sum + (recordedCost(file, timings) ?? 0),
    0,
  );
}

/**
 * Return the slice of `files` assigned to `shard` of `total`. Callers pass a
 * sorted list so the result is deterministic. Throws on out-of-range
 * shard/total.
 */
export function partitionTestFiles(
  files: string[],
  total: number,
  shard: number,
  timings?: FileDurations,
): string[] {
  assertShardArgs(total, shard);
  return planShards(files, total, timings)[shard];
}

/**
 * Verify that partitioning `files` into `total` shards covers every file
 * exactly once — no gaps, no duplicates. Throws with a descriptive message on
 * any violation. This is the invariant behind acceptance-criterion "every
 * test file runs exactly once across the matrix", and it holds for the
 * cost-weighted plan exactly as it did for the round-robin one.
 */
export function verifyShardCoverage(
  files: string[],
  total: number,
  timings?: FileDurations,
): void {
  const plan = planShards(files, total, timings);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const slice of plan) {
    for (const file of slice) {
      if (seen.has(file)) {
        duplicates.push(file);
      }
      seen.add(file);
    }
  }
  if (duplicates.length > 0) {
    throw new Error(
      `duplicate files across shards: ${duplicates.slice(0, 5).join(", ")}`,
    );
  }
  const missing = files.filter((file) => !seen.has(file));
  if (missing.length > 0) {
    throw new Error(
      `unassigned files: ${missing.slice(0, 5).join(", ")}`,
    );
  }
  if (seen.size !== files.length) {
    throw new Error(
      `shard union covers ${seen.size} files but expected ${files.length}`,
    );
  }
}

/**
 * Read the committed per-file durations written by `scripts/merge_junit.ts`.
 * Fails loud — a missing, unreadable, or malformed document throws rather than
 * quietly degrading the plan; the caller decides whether absence is tolerable
 * (see `resolveTimings`).
 */
export async function loadTimings(
  path: string = DEFAULT_TIMINGS_PATH,
): Promise<FileDurations> {
  const raw = await Deno.readTextFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error}`);
  }
  const files = (parsed as { files?: unknown } | null)?.files;
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    throw new Error(`${path} must contain a 'files' object of path→seconds`);
  }
  const durations: Record<string, number> = {};
  for (const [file, seconds] of Object.entries(files)) {
    if (
      typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0
    ) {
      throw new Error(
        `${path}: '${file}' must map to a non-negative number, got ${
          JSON.stringify(seconds)
        }`,
      );
    }
    durations[file] = seconds;
  }
  return durations;
}

function parseIntFlag(
  args: string[],
  name: string,
): number | undefined {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  if (match === undefined) return undefined;
  const raw = match.slice(prefix.length);
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`--${name} must be an integer, got '${raw}'`);
  }
  return value;
}

function parseStringFlag(
  args: string[],
  name: string,
): string | undefined {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match === undefined ? undefined : match.slice(prefix.length);
}

/**
 * Load the timings every mode plans with. An explicitly requested `--timings`
 * path must exist — asking for a file that is not there is an error. The
 * default path is optional: a repository with no published timings yet falls
 * back to round-robin, and says so on stderr rather than silently. A corrupt
 * document always fails loud, whichever path it came from.
 */
async function resolveTimings(
  args: string[],
): Promise<FileDurations | undefined> {
  const explicit = parseStringFlag(args, "timings");
  const path = explicit ?? DEFAULT_TIMINGS_PATH;
  try {
    return await loadTimings(path);
  } catch (error) {
    if (explicit === undefined && error instanceof Deno.errors.NotFound) {
      console.error(
        `no timings at ${path}; falling back to round-robin sharding`,
      );
      return undefined;
    }
    throw error;
  }
}

async function main(args: string[]): Promise<number> {
  const root = parseStringFlag(args, "root") ?? "test";
  const files = await collectTestFiles(root);

  if (args.includes("--count")) {
    console.log(String(files.length));
    return 0;
  }

  const timings = await resolveTimings(args);

  if (args.includes("--verify")) {
    const total = parseIntFlag(args, "total");
    if (total === undefined) {
      console.error("--verify requires --total=<N>");
      return 2;
    }
    verifyShardCoverage(files, total, timings);
    console.error(
      `OK: ${files.length} files covered once across ${total} shards`,
    );
    return 0;
  }

  if (args.includes("--plan")) {
    const total = parseIntFlag(args, "total");
    if (total === undefined) {
      console.error("--plan requires --total=<N>");
      return 2;
    }
    const plan = planShards(files, total, timings);
    const costs = plan.map((slice) => shardCost(slice, timings));
    plan.forEach((slice, shard) => {
      console.log(
        `shard ${shard}: ${slice.length} files, ${costs[shard].toFixed(1)}s`,
      );
    });
    const totalCost = costs.reduce((sum, cost) => sum + cost, 0);
    console.log(
      `slowest ${Math.max(...costs).toFixed(1)}s, ` +
        `even split ${(totalCost / total).toFixed(1)}s, ` +
        `total ${totalCost.toFixed(1)}s`,
    );
    return 0;
  }

  if (args.includes("--list")) {
    const total = parseIntFlag(args, "total");
    const shard = parseIntFlag(args, "shard");
    if (total === undefined || shard === undefined) {
      console.error("--list requires --shard=<i> and --total=<N>");
      return 2;
    }
    const slice = partitionTestFiles(files, total, shard, timings);
    if (slice.length > 0) {
      console.log(slice.join("\n"));
    }
    return 0;
  }

  console.error(
    "usage: shard_test_files.ts (--list --shard=i --total=N | --verify --total=N" +
      " | --plan --total=N | --count) [--timings=<path>]",
  );
  return 2;
}

if (import.meta.main) {
  const code = await main(Deno.args);
  Deno.exit(code);
}
