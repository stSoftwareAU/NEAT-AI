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
 * CLI usage:
 *   deno run --allow-read --allow-write scripts/merge_junit.ts \
 *     --output=junit.xml junit-0.xml junit-1.xml ...
 */

interface SuiteTotals {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
}

function readNumberAttr(openingTag: string, name: string): number {
  const match = openingTag.match(new RegExp(`\\b${name}="([^"]*)"`));
  if (match === null) return 0;
  const value = Number(match[1]);
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
    totals.tests += readNumberAttr(tag, "tests");
    totals.failures += readNumberAttr(tag, "failures");
    totals.errors += readNumberAttr(tag, "errors");
    totals.skipped += readNumberAttr(tag, "skipped");
    totals.time += readNumberAttr(tag, "time");
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

function parseStringFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match === undefined ? undefined : match.slice(prefix.length);
}

async function main(args: string[]): Promise<number> {
  const output = parseStringFlag(args, "output") ?? "junit.xml";
  const inputs = args.filter((arg) => !arg.startsWith("--"));
  if (inputs.length === 0) {
    console.error("usage: merge_junit.ts --output=junit.xml <file...>");
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
  const merged = mergeJunitXml(contents);
  await Deno.writeTextFile(output, merged);
  console.error(`merged ${inputs.length} report(s) into ${output}`);
  return 0;
}

if (import.meta.main) {
  const code = await main(Deno.args);
  Deno.exit(code);
}
