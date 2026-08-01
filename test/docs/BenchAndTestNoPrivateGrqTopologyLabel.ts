/**
 * Issue #3616 — bench titles, test titles, scripts and live docs must not use
 * the names of the private `stSoftwareAU` repositories `GRQ-cluster` and
 * `GRQ-teams` as topology labels.
 *
 * A public repository is fully self-contained for the public. A test named
 * "GRQ-cluster creature has ~1,500 neurons" asserts parity with a repository a
 * public reader cannot open, so the claim is unverifiable and the label is dead
 * weight — the fixtures it exercises are generated synthetically in-tree and
 * need no private name. This guard walks the real bench, test, script and live
 * doc trees and fails if any reintroduces one of those topology labels.
 *
 * Matching is case-sensitive on the upper-case repo tokens, so the in-tree
 * lower-case `grq-cluster` scale-preset name stays legal — it identifies a
 * synthetic fixture preset, not a private repository, matching the `grq-3397`
 * carve-out recorded in `test/_privateRepoRefs.ts`.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { walk } from "@std/fs";

/**
 * The private repository names that must not be used as topology labels.
 * Upper-case only — see the module note on the lower-case preset carve-out.
 */
const PRIVATE_TOPOLOGY_LABEL_PATTERN = /GRQ-cluster|GRQ-teams/;

/**
 * Return every line using a private `GRQ-cluster` / `GRQ-teams` repository name
 * as a topology label.
 *
 * @param source raw file content (TypeScript, Markdown or shell)
 * @returns 1-indexed line numbers carrying a private topology label
 */
export function findPrivateGrqTopologyLabels(source: string): number[] {
  const hits: number[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (PRIVATE_TOPOLOGY_LABEL_PATTERN.test(lines[i])) {
      hits.push(i + 1);
    }
  }
  return hits;
}

const ROOT = fromFileUrl(new URL("../..", import.meta.url));

/** Trees walked by the guard, relative to the repository root. */
const SCANNED_DIRS = ["bench", "scripts", "test", "docs"];

/**
 * Repo-relative paths exempt from the guard.
 *
 * `docs/archive/` is a historical record that is never rewritten, and the
 * private-repo guards below must name the tokens they detect.
 */
const EXEMPT = new Set([
  "test/_privateRepoRefs.ts",
  "test/docs/BenchAndTestNoPrivateGrqTopologyLabel.ts",
  "test/docs/CrossSpeciesBaselineNoPrivateRepo.ts",
  "test/docs/LiveDocsNoPrivateGrqReference.ts",
  "test/docs/PrivateRepoRefScanner.ts",
  "test/scripts/AuditOptionUsageNoPrivateConsumer.ts",
]);

Deno.test("bench, test, script and live doc trees carry no private GRQ topology label (#3616)", async () => {
  const offenders: string[] = [];
  for (const dir of SCANNED_DIRS) {
    for await (
      const entry of walk(`${ROOT}${dir}`, {
        exts: [".ts", ".md", ".sh"],
        includeDirs: false,
      })
    ) {
      const rel = entry.path.slice(ROOT.length);
      if (rel.startsWith("docs/archive/") || EXEMPT.has(rel)) continue;
      const hits = findPrivateGrqTopologyLabels(
        await Deno.readTextFile(entry.path),
      );
      if (hits.length > 0) offenders.push(`${rel}:${hits.join(",")}`);
    }
  }
  assertEquals(
    offenders.sort(),
    [],
    `Private GRQ-cluster / GRQ-teams repository names are used as topology ` +
      `labels:\n${offenders.join("\n")}\n` +
      `Reword to concept level (e.g. "production-scale creature", "a large ` +
      `production teams creature") so the label stays meaningful to public ` +
      `readers.`,
  );
});

Deno.test("findPrivateGrqTopologyLabels flags GRQ-cluster and GRQ-teams labels", () => {
  const src = [
    'Deno.test("GRQ-cluster creature has ~1,500 neurons", () => {',
    "  // unrelated line",
    " * modelled on the GRQ-teams Europa creature shape",
  ].join("\n");
  assertEquals(findPrivateGrqTopologyLabels(src), [1, 3]);
});

Deno.test("findPrivateGrqTopologyLabels ignores the lower-case preset and bare mnemonics", () => {
  const src = [
    '  const creature = generateProductionCreature(648, 2, rng, { scale: "grq-cluster" });',
    ' * `"grq-3397"`: 1,666 neurons at 2,461 inputs.',
    " * ~1,500 neurons, ~20,000 synapses (GRQ production scale)",
  ].join("\n");
  assertEquals(findPrivateGrqTopologyLabels(src), []);
});

Deno.test("findPrivateGrqTopologyLabels returns empty for concept-level prose", () => {
  const src = [
    'Deno.test("Production-scale creature has ~1,500 neurons", () => {',
    "The downstream run-result file records the scorer utilisation block.",
  ].join("\n");
  assertEquals(findPrivateGrqTopologyLabels(src), []);
});

Deno.test("findPrivateGrqTopologyLabels returns empty for empty input", () => {
  assertEquals(findPrivateGrqTopologyLabels(""), []);
});
