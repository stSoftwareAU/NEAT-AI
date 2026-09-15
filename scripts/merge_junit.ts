#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * Merge the per-shard JUnit XML reports produced by the sharded coverage
 * workflow into a single consolidated `<testsuites>` document (Issue #3173).
 *
 * The sharded `coverage.yaml` job runs `deno test --reporter junit` over a
 * slice of the suite per shard, so CI ends up with `junit-0.xml` …
 * `junit-<N-1>.xml`. Publishing N separate reports would create N "Test
 * Results" checks and N Codecov uploads; merging them yields the single
 * consolidated report the acceptance criteria require.
 *
 * CLI usage — scope the write grant to the output path (Issue #3681); the CI
 * job that runs this script also holds `secrets.CODECOV_TOKEN`, and an
 * unrestricted grant would reach `$GITHUB_ENV` / `$GITHUB_PATH`:
 *   deno run --allow-read --allow-write=junit.xml scripts/merge_junit.ts \
 *     --output=junit.xml junit-0.xml junit-1.xml ...
 *
 * `--timings=<path>` additionally publishes the per-file cost map the
 * cost-weighted shard planner consumes (Issue #4017); scope the write grant to
 * that path too:
 *   deno run --allow-read --allow-write=test-timings.json \
 *     scripts/merge_junit.ts --timings=test-timings.json junit.xml
 */

interface SuiteTotals {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
}

// Parse the attributes of an XML opening tag into a name→value map using a
// single hardcoded regex. Building the pattern statically (rather than
// `new RegExp(name + ...)` per attribute) avoids the ReDoS-prone dynamic
// RegExp construction Semgrep flags and parses each tag only once.
function parseAttrs(openingTag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const [, name, value] of openingTag.matchAll(/([\w.-]+)="([^"]*)"/g)) {
    attrs.set(name, value);
  }
  return attrs;
}

function readNumberAttr(attrs: Map<string, string>, name: string): number {
  const raw = attrs.get(name);
  if (raw === undefined) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Extract the inner `<testsuite>…</testsuite>` body from a single JUnit
 * document. If the document has no `<testsuites>` wrapper it is returned
 * as-is (already a bare suite list).
 */
function extractSuites(content: string): string {
  const match = content.match(/<testsuites\b[^>]*>([\s\S]*)<\/testsuites>/);
  if (match !== null) {
    return match[1].trim();
  }
  // No wrapper: strip any XML/doctype prolog and return the remainder.
  return content.replace(/<\?xml[^>]*\?>/g, "").trim();
}

function tallyTotals(suitesBody: string, totals: SuiteTotals): void {
  const openingTags = suitesBody.match(/<testsuite\b[^>]*>/g) ?? [];
  for (const tag of openingTags) {
    const attrs = parseAttrs(tag);
    totals.tests += readNumberAttr(attrs, "tests");
    totals.failures += readNumberAttr(attrs, "failures");
    totals.errors += readNumberAttr(attrs, "errors");
    totals.skipped += readNumberAttr(attrs, "skipped");
    totals.time += readNumberAttr(attrs, "time");
  }
}

/**
 * Merge multiple JUnit XML document strings into a single `<testsuites>`
 * document. Root-level aggregate counts (tests/failures/errors/skipped/time)
 * are recomputed by summing the child `<testsuite>` attributes so the
 * consolidated header is accurate. Empty/blank inputs are ignored.
 */
export function mergeJunitXml(contents: string[]): string {
  const totals: SuiteTotals = {
    tests: 0,
    failures: 0,
    errors: 0,
    skipped: 0,
    time: 0,
  };
  const bodies: string[] = [];
  for (const content of contents) {
    if (content.trim().length === 0) continue;
    const body = extractSuites(content);
    if (body.length === 0) continue;
    tallyTotals(body, totals);
    bodies.push(body);
  }
  const header =
    `<testsuites tests="${totals.tests}" failures="${totals.failures}"` +
    ` errors="${totals.errors}" skipped="${totals.skipped}"` +
    ` time="${totals.time.toFixed(6)}">`;
  const inner = bodies.length > 0 ? `\n${bodies.join("\n")}\n` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n${header}${inner}</testsuites>\n`;
}

/**
 * Count the total failures + errors reported across the merged suites. Used by
 * callers that need a single "did any test fail?" signal.
 */
export function countJunitFailures(
  contents: string[],
): { failures: number; errors: number } {
  const totals: SuiteTotals = {
    tests: 0,
    failures: 0,
    errors: 0,
    skipped: 0,
    time: 0,
  };
  for (const content of contents) {
    if (content.trim().length === 0) continue;
    tallyTotals(extractSuites(content), totals);
  }
  return { failures: totals.failures, errors: totals.errors };
}

/**
 * Per-file test cost map published by the merge job and consumed by the
 * cost-weighted shard planner in `scripts/shard_test_files.ts` (Issue #4017).
 * Durations are seconds of *test* time (the sum of the file's testcase times),
 * not wall-clock — that is the quantity a shard's slice accumulates.
 */
export interface TestTimings {
  version: number;
  unit: "seconds";
  generated?: string;
  files: Record<string, number>;
}

/** Normalise a JUnit suite name to a repo-relative POSIX path. */
function normaliseSuiteName(name: string): string {
  return name.replaceAll("\\", "/").replace(/^\.\//, "");
}

function sumTestcaseTimes(suiteBody: string): number | undefined {
  const tags = suiteBody.match(/<testcase\b[^>]*>/g);
  if (tags === null || tags.length === 0) return undefined;
  let total = 0;
  for (const tag of tags) {
    total += readNumberAttr(parseAttrs(tag), "time");
  }
  return total;
}

/**
 * Sum each test file's total test time across the given JUnit documents,
 * keyed by repo-relative path. A file's cost is the sum of its testcase
 * times; a suite with no testcases falls back to its own `time` attribute,
 * and an empty (self-closing) suite is recorded as zero so the planner treats
 * it as measured-and-cheap rather than unmeasured. Durations accumulate when
 * the same file appears in more than one document.
 */
export function extractFileDurations(contents: string[]): Map<string, number> {
  const durations = new Map<string, number>();
  const add = (rawName: string, seconds: number) => {
    const name = normaliseSuiteName(rawName);
    if (name.length === 0) return;
    durations.set(name, (durations.get(name) ?? 0) + seconds);
  };
  for (const content of contents) {
    if (content.trim().length === 0) continue;
    const body = extractSuites(content);
    if (body.length === 0) continue;
    for (
      const [, openingTag, suiteBody] of body.matchAll(
        /(<testsuite\b[^>]*[^/]>)([\s\S]*?)<\/testsuite>/g,
      )
    ) {
      const attrs = parseAttrs(openingTag);
      const name = attrs.get("name");
      if (name === undefined) continue;
      const measured = sumTestcaseTimes(suiteBody) ??
        readNumberAttr(attrs, "time");
      add(name, measured);
    }
    // Empty suites are emitted self-closing and carry no testcases at all.
    for (const tag of body.match(/<testsuite\b[^>]*\/>/g) ?? []) {
      const attrs = parseAttrs(tag);
      const name = attrs.get("name");
      if (name === undefined) continue;
      add(name, readNumberAttr(attrs, "time"));
    }
  }
  return durations;
}

/**
 * Build the committed timings document from JUnit report contents. `generated`
 * is injected rather than read from the clock so the transform stays pure and
 * unit-testable. Durations are rounded to milliseconds to keep the committed
 * file small.
 */
export function buildTimings(
  contents: string[],
  generated?: string,
): TestTimings {
  const durations = extractFileDurations(contents);
  const files: Record<string, number> = {};
  for (const name of [...durations.keys()].sort()) {
    files[name] = Math.round(durations.get(name)! * 1000) / 1000;
  }
  return {
    version: 1,
    unit: "seconds",
    ...(generated === undefined ? {} : { generated }),
    files,
  };
}

function parseStringFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match === undefined ? undefined : match.slice(prefix.length);
}

async function main(args: string[]): Promise<number> {
  const timingsPath = parseStringFlag(args, "timings");
  // `--timings` on its own publishes only the cost map; the merged report is
  // still written whenever `--output` is given or no mode flag is passed at
  // all (the historical default).
  const output = parseStringFlag(args, "output") ??
    (timingsPath === undefined ? "junit.xml" : undefined);
  const inputs = args.filter((arg) => !arg.startsWith("--"));
  if (inputs.length === 0) {
    console.error(
      "usage: merge_junit.ts [--output=junit.xml] [--timings=test-timings.json] <file...>",
    );
    return 2;
  }
  const contents = await Promise.all(
    inputs.map(async (path) => {
      try {
        return await Deno.readTextFile(path);
      } catch (error) {
        console.error(`skipping unreadable ${path}: ${error}`);
        return "";
      }
    }),
  );
  if (output !== undefined) {
    await Deno.writeTextFile(output, mergeJunitXml(contents));
    console.error(`merged ${inputs.length} report(s) into ${output}`);
  }
  if (timingsPath !== undefined) {
    const timings = buildTimings(contents, new Date().toISOString());
    await Deno.writeTextFile(
      timingsPath,
      `${JSON.stringify(timings, null, 2)}\n`,
    );
    console.error(
      `wrote ${
        Object.keys(timings.files).length
      } per-file timings to ${timingsPath}`,
    );
  }
  return 0;
}

if (import.meta.main) {
  const code = await main(Deno.args);
  Deno.exit(code);
}
