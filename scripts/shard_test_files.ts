#!/usr/bin/env -S deno run --allow-read
/**
 * Deterministically partition the `test/**\/*.ts` file list across N CI
 * shards so the coverage workflow can run the suite in parallel matrix jobs
 * (Issue #3173).
 *
 * `deno test` has no native `--shard` flag, so we partition the sorted file
 * list ourselves. Sharding is a stable round-robin over the *sorted* file
 * list: shard `s` (of `total`) runs every file whose sorted index `i`
 * satisfies `i % total === s`. Because the list is sorted first, the mapping
 * is deterministic across runners and every file is assigned to exactly one
 * shard — no gaps, no double-runs. Round-robin also balances the slice sizes
 * to within one file of each other.
 *
 * CLI usage (all modes read the on-disk `test/` tree):
 *
 *   # Print this shard's slice, one path per line (fed to `deno test`):
 *   deno run --allow-read scripts/shard_test_files.ts --list --shard=0 --total=8
 *
 *   # Assert every file is covered exactly once across all shards; non-zero
 *   # exit on any gap or duplicate (the CI file-count parity gate):
 *   deno run --allow-read scripts/shard_test_files.ts --verify --total=8
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

/**
 * Return the slice of `files` assigned to `shard` of `total` via a stable
 * round-robin over the input order. Callers pass a sorted list so the result
 * is deterministic. Throws on out-of-range shard/total.
 */
export function partitionTestFiles(
  files: string[],
  total: number,
  shard: number,
): string[] {
  assertShardArgs(total, shard);
  return files.filter((_file, index) => index % total === shard);
}

/**
 * Verify that partitioning `files` into `total` shards covers every file
 * exactly once — no gaps, no duplicates. Throws with a descriptive message on
 * any violation. This is the invariant behind acceptance-criterion "every
 * test file runs exactly once across the matrix".
 */
export function verifyShardCoverage(files: string[], total: number): void {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`total must be a positive integer, got ${total}`);
  }
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (let shard = 0; shard < total; shard++) {
    const slice = partitionTestFiles(files, total, shard);
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

async function main(args: string[]): Promise<number> {
  const root = parseStringFlag(args, "root") ?? "test";
  const files = await collectTestFiles(root);

  if (args.includes("--count")) {
    console.log(String(files.length));
    return 0;
  }

  if (args.includes("--verify")) {
    const total = parseIntFlag(args, "total");
    if (total === undefined) {
      console.error("--verify requires --total=<N>");
      return 2;
    }
    verifyShardCoverage(files, total);
    console.error(
      `OK: ${files.length} files covered once across ${total} shards`,
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
    const slice = partitionTestFiles(files, total, shard);
    if (slice.length > 0) {
      console.log(slice.join("\n"));
    }
    return 0;
  }

  console.error(
    "usage: shard_test_files.ts (--list --shard=i --total=N | --verify --total=N | --count)",
  );
  return 2;
}

if (import.meta.main) {
  const code = await main(Deno.args);
  Deno.exit(code);
}
