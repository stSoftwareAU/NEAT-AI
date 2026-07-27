/**
 * Issue #3458 — live automation, contributor docs and their tests must stay
 * self-contained for public readers and must not cite the private
 * `stSoftwareAU` issue trackers (`VibeCoding#NNNN`, `GRQ#NNNN`) or an
 * org-qualified private repo slug/link.
 *
 * `bump-deps.sh` ships in every public clone and printed two
 * `VibeCoding#1613` slugs to stderr at runtime, so a public user running the
 * script was pointed at an issue they cannot open. The behaviour being
 * described — the automated dependency-bump worker reverting a bump when
 * either audit gate fails — is fully expressible at concept level.
 *
 * These tests read the real committed files and fail if any reintroduces a
 * private-repo reference. The public `stSoftwareAU/NEAT-AI` repository and its
 * own `#NNNN` issue numbers are deliberately not matched.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/** Files named in the #3458 private-repo-reference audit. */
const AUDITED_FILES = [
  "../../bump-deps.sh",
  "../../AGENTS.md",
  "../../test/scripts/BumpDepsScript.ts",
];

/**
 * Match a private `stSoftwareAU` repository reference: an issue-tracker slug
 * (`VibeCoding#3532`, `GRQ#3472`) or an org-qualified slug / link
 * (`stSoftwareAU/VibeCoding`, `github.com/stSoftwareAU/GRQ-cluster/...`).
 *
 * Case-sensitive on the upper-case repo tokens so the lower-case in-tree
 * `grq-3397` scale-preset fixture is never a false positive.
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
        `usable by public readers.`,
    );
  });
}

Deno.test("bump-deps.sh revert guidance is concept level (#3458)", async () => {
  const path = fromFileUrl(new URL("../../bump-deps.sh", import.meta.url));
  const source = await Deno.readTextFile(path);
  const revertLines = source
    .split("\n")
    .filter((line) => line.includes("should revert"));
  assertEquals(
    revertLines.length,
    2,
    "expected both audit-gate failure paths to print revert guidance",
  );
  for (const line of revertLines) {
    assert(
      line.includes("Worker should revert this bump."),
      `runtime revert guidance must be self-contained, got: ${line.trim()}`,
    );
  }
});

Deno.test("findPrivateRepoReferences flags a VibeCoding# slug", () => {
  const src = 'echo "Worker should revert per VibeCoding#1613." >&2\n';
  assertEquals(findPrivateRepoReferences(src), [1]);
});

Deno.test("findPrivateRepoReferences flags a bare GRQ# slug", () => {
  const src = [
    "# Intro line.",
    "# handed to the production repo (GRQ#3472) with the tool.",
  ].join("\n");
  assertEquals(findPrivateRepoReferences(src), [2]);
});

Deno.test("findPrivateRepoReferences flags an org-qualified private repo path", () => {
  const src =
    "see https://github.com/stSoftwareAU/GRQ-cluster/blob/main/network.json here.\n";
  assertEquals(findPrivateRepoReferences(src), [1]);
});

Deno.test("findPrivateRepoReferences ignores the public NEAT-AI repo", () => {
  const src = "Filed at https://github.com/stSoftwareAU/NEAT-AI/issues/3458.\n";
  assertEquals(findPrivateRepoReferences(src), []);
});

Deno.test("findPrivateRepoReferences ignores the lower-case grq-3397 fixture", () => {
  const src = "The synthetic `grq-3397` scale preset reproduces dimensions.\n";
  assertEquals(findPrivateRepoReferences(src), []);
});

Deno.test("findPrivateRepoReferences returns empty for concept-level prose", () => {
  const src = [
    "# The automated dependency-bump worker reverts the bump when either",
    "# audit gate fails (Issue #2465).",
  ].join("\n");
  assertEquals(findPrivateRepoReferences(src), []);
});

Deno.test("findPrivateRepoReferences returns empty for empty input", () => {
  assertEquals(findPrivateRepoReferences(""), []);
});
