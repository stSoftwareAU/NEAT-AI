/**
 * Issue #3458 — live automation, contributor docs and the bump-deps test
 * comment must not reference the private `stSoftwareAU` issue trackers.
 *
 * `bump-deps.sh` ships in every public clone and prints two of these
 * references to stderr at runtime, so a `VibeCoding#NNNN` / `GRQ#NNNN` slug
 * points a public reader (or a public user running the script) at an issue
 * they cannot open. The behaviour being described — the automated
 * dependency-bump worker reverting a bump when a gate fails — is expressible
 * at concept level without a slug.
 *
 * The test reads the real committed files and fails if any reintroduces a
 * private-repo issue slug, org-qualified slug or link. The public
 * `stSoftwareAU/NEAT-AI` repository is deliberately not matched.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/** Files named in the #3458 private-repo-reference audit. */
const AUDITED_FILES = [
  "../../bump-deps.sh",
  "../../AGENTS.md",
  "./BumpDepsScript.ts",
];

/**
 * Match a private `stSoftwareAU` repository reference: an issue-tracker slug
 * (`VibeCoding#1613`, `GRQ#3472`) or an org-qualified slug / link
 * (`stSoftwareAU/VibeCoding`, `github.com/stSoftwareAU/GRQ-cluster/...`).
 *
 * Case-sensitive on the upper-case repo tokens so lower-case in-tree fixtures
 * are never false positives.
 */
const PRIVATE_REPO_PATTERN =
  /(?:GRQ|VibeCoding)#\d+|stSoftwareAU\/(?:GRQ-cluster|GRQ-logs|GRQ|VibeCoding)/;

/**
 * Return every 1-indexed line number carrying a private `stSoftwareAU`
 * repository issue slug, org-qualified slug or link.
 *
 * @param source raw file source
 * @returns 1-indexed line numbers with a private-repo reference
 */
export function findPrivateRepoReferences(source: string): number[] {
  const hits: number[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (PRIVATE_REPO_PATTERN.test(lines[i])) {
      hits.push(i + 1);
    }
  }
  return hits;
}

for (const rel of AUDITED_FILES) {
  Deno.test(`${rel} has no private repo reference (#3458)`, async () => {
    const path = fromFileUrl(new URL(rel, import.meta.url));
    const source = await Deno.readTextFile(path);
    const hits = findPrivateRepoReferences(source);
    assertEquals(
      hits,
      [],
      `${rel} references a private stSoftwareAU repository on line(s) ` +
        `${hits.join(", ")}. Reword to concept level so the file stays ` +
        `meaningful to public readers.`,
    );
  });
}

Deno.test("findPrivateRepoReferences flags a VibeCoding# slug", () => {
  const src = 'echo "Worker should revert per VibeCoding#1613." >&2\n';
  assertEquals(findPrivateRepoReferences(src), [1]);
});

Deno.test("findPrivateRepoReferences flags an org-qualified private repo", () => {
  const src = [
    "Intro line.",
    "see https://github.com/stSoftwareAU/GRQ-cluster/blob/main/x.json here.",
  ].join("\n");
  assertEquals(findPrivateRepoReferences(src), [2]);
});

Deno.test("findPrivateRepoReferences ignores the public NEAT-AI repo", () => {
  const src =
    "Filed at https://github.com/stSoftwareAU/NEAT-AI/issues/3458 (public).\n";
  assertEquals(findPrivateRepoReferences(src), []);
});

Deno.test("findPrivateRepoReferences ignores a bare in-repo issue number", () => {
  const src = "# Audit gate (two-phase, Issue #2465): reverts on failure.\n";
  assertEquals(findPrivateRepoReferences(src), []);
});

Deno.test("findPrivateRepoReferences returns empty for concept-level prose", () => {
  const src =
    "Either gate failing exits non-zero and the worker reverts the bump.\n";
  assertEquals(findPrivateRepoReferences(src), []);
});

Deno.test("findPrivateRepoReferences returns empty for empty input", () => {
  assertEquals(findPrivateRepoReferences(""), []);
});
