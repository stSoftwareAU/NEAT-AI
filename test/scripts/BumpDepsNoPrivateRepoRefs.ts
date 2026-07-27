/**
 * Issue #3458 — live automation and contributor docs must stay self-contained
 * for public readers.
 *
 * `bump-deps.sh` ships in every public clone and prints two of these lines to
 * stderr at runtime, so a private issue-tracker slug (`VibeCoding#1613`,
 * `GRQ#3472`) points a public user at a tracker they cannot open. The contract
 * being described — the automated dependency-bump worker reverts the bump when
 * a gate fails — is expressible at concept level without the slug.
 *
 * This test walks the real committed files and fails if any reintroduces a
 * private-repo slug or org-qualified private repo path.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../..", import.meta.url));

/**
 * Live automation, contributor docs and their tests — the files called out by
 * the private-repo-reference audit. Paths are repo-root relative.
 */
const SCANNED_FILES = [
  "bump-deps.sh",
  "AGENTS.md",
  "test/scripts/BumpDepsScript.ts",
];

/**
 * Match a private `stSoftwareAU` issue-tracker slug (`VibeCoding#1613`,
 * `GRQ#3472`) or an org-qualified private repo path / link.
 */
const PRIVATE_REPO_PATTERN =
  /(?:GRQ|VibeCoding)#\d+|stSoftwareAU\/(?:GRQ-cluster|GRQ-logs|GRQ|VibeCoding)/;

/**
 * Return every 1-indexed line number carrying a private-repo reference.
 *
 * @param source raw file source
 * @returns 1-indexed line numbers with a private-repo reference
 */
export function findPrivateRepoRefs(source: string): number[] {
  const hits: number[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (PRIVATE_REPO_PATTERN.test(lines[i])) {
      hits.push(i + 1);
    }
  }
  return hits;
}

Deno.test("no private repo slugs in bump-deps automation or its docs (#3458)", async () => {
  const sources = await Promise.all(
    SCANNED_FILES.map((relative) =>
      Deno.readTextFile(`${REPO_ROOT}${relative}`)
    ),
  );
  const offenders: string[] = [];
  for (let i = 0; i < SCANNED_FILES.length; i++) {
    const hits = findPrivateRepoRefs(sources[i]);
    if (hits.length > 0) {
      offenders.push(`${SCANNED_FILES[i]}:${hits.join(",")}`);
    }
  }
  assertEquals(
    offenders,
    [],
    `Found private stSoftwareAU repo slugs in live automation or docs:\n` +
      `${offenders.join("\n")}\n` +
      `Reword to concept level (e.g. "the automated dependency-bump worker ` +
      `reverts the bump when either gate fails") so public readers can follow.`,
  );
});

Deno.test("bump-deps.sh revert guidance stays concept level (#3458)", async () => {
  const source = await Deno.readTextFile(`${REPO_ROOT}bump-deps.sh`);
  const revertLines = source
    .split("\n")
    .filter((line) => /Worker should revert/.test(line));
  assertEquals(
    revertLines.length,
    2,
    "expected both gate failures to emit revert guidance",
  );
  for (const line of revertLines) {
    assert(
      line.includes("Worker should revert this bump."),
      `expected concept-level revert message; got: ${line}`,
    );
  }
});

Deno.test("findPrivateRepoRefs flags a bare VibeCoding# slug", () => {
  const src = [
    "# bump-deps.sh — pre-PR dependency refresh",
    "# worker before quality.sh (see VibeCoding#1613, #1614).",
    "set -euo pipefail",
  ].join("\n");
  assertEquals(findPrivateRepoRefs(src), [2]);
});

Deno.test("findPrivateRepoRefs flags a bare GRQ# slug", () => {
  const src = "reducing `popSize` (GRQ#3472 keeps population = 20).\n";
  assertEquals(findPrivateRepoRefs(src), [1]);
});

Deno.test("findPrivateRepoRefs flags an org-qualified private repo path", () => {
  const src = "statistics derived from `stSoftwareAU/GRQ-cluster`.\n";
  assertEquals(findPrivateRepoRefs(src), [1]);
});

Deno.test("findPrivateRepoRefs allows this repo's own issue numbers", () => {
  const src = [
    "# Audit gate (two-phase, Issue #2465):",
    "#   The automated dependency-bump worker then reverts the bump.",
    'echo "Worker should revert this bump." >&2',
  ].join("\n");
  assertEquals(findPrivateRepoRefs(src), []);
});

Deno.test("findPrivateRepoRefs returns empty for empty input", () => {
  assertEquals(findPrivateRepoRefs(""), []);
});
