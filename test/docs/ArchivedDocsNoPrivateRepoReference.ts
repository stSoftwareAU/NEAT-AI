/**
 * Issue #3455 — archived documentation must stay self-contained for public
 * readers and must not name or link the private `stSoftwareAU` repositories
 * `GRQ`, `GRQ-cluster`, `GRQ-logs` or `VibeCoding`.
 *
 * A public repository is fully self-contained for the public. Archived PR
 * summaries and investigations ship in every public clone, so a `GRQ#NNNN` /
 * `VibeCoding#NNNN` issue-tracker slug, an `stSoftwareAU/<private-repo>` slug,
 * or a `github.com/stSoftwareAU/<private-repo>` link points a public reader at
 * an issue or file they cannot open. The archived narrative keeps its meaning
 * when reworded to concept level.
 *
 * This test reads the real archived docs named in the audit and fails if any
 * reintroduces a private-repo issue slug, org-qualified slug or link. It
 * exercises behaviour (committed doc content), not the source text of any
 * function. The public `stSoftwareAU/NEAT-AI` repository is deliberately not
 * matched, and bare `GRQ-cluster` production mnemonics (no `#`, no
 * `stSoftwareAU/` prefix) are out of scope per the #3454 convention.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/** Archived docs named in the #3455 private-repo-reference audit. */
const ARCHIVED_DOCS = [
  "../../docs/archive/pr-summaries/pr-summary-3018.md",
  "../../docs/archive/pr-summaries/pr-summary-3400.md",
  "../../docs/archive/pr-summaries/pr-summary-3410.md",
  "../../docs/archive/pr-summaries/pr-summary-3412.md",
  "../../docs/archive/pr-summaries/pr-summary-3417.md",
  "../../docs/archive/investigations/issue-2515-forward-only-apply-audit.md",
];

/**
 * Match a private `stSoftwareAU` repository reference:
 *   - an issue-tracker slug (`GRQ#3472`, `VibeCoding#3532`),
 *   - an org-qualified slug or link (`stSoftwareAU/GRQ-cluster`,
 *     `github.com/stSoftwareAU/VibeCoding/...`).
 *
 * Case-sensitive on the upper-case repo tokens so the lower-case in-tree
 * `grq-3397` scale-preset fixture is never a false positive. The public
 * `NEAT-AI` repository is intentionally absent from the alternation.
 */
const PRIVATE_REPO_PATTERN =
  /(?:GRQ|VibeCoding)#\d+|stSoftwareAU\/(?:GRQ-cluster|GRQ-logs|GRQ|VibeCoding)/;

/**
 * Return every 1-indexed line number carrying a private `stSoftwareAU`
 * repository issue slug, org-qualified slug or link.
 *
 * @param source raw Markdown source
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

for (const rel of ARCHIVED_DOCS) {
  Deno.test(`archived doc ${rel} has no private repo reference (#3455)`, async () => {
    const path = fromFileUrl(new URL(rel, import.meta.url));
    const source = await Deno.readTextFile(path);
    const hits = findPrivateRepoReferences(source);
    assertEquals(
      hits,
      [],
      `${rel} references a private stSoftwareAU repository on line(s) ` +
        `${hits.join(", ")}. Reword to concept level so the archived doc ` +
        `stays verifiable by public readers.`,
    );
  });
}

Deno.test("findPrivateRepoReferences flags a GRQ issue slug", () => {
  const src = [
    "Intro line.",
    "handed to the production repo (stSoftwareAU/GRQ#3472) with the tool.",
    "Closing line.",
  ].join("\n");
  assertEquals(findPrivateRepoReferences(src), [2]);
});

Deno.test("findPrivateRepoReferences flags a bare GRQ# slug", () => {
  const src = "reducing popSize (GRQ#3472 keeps population = 20).\n";
  assertEquals(findPrivateRepoReferences(src), [1]);
});

Deno.test("findPrivateRepoReferences flags a VibeCoding# slug", () => {
  const src = "tracked separately as stSoftwareAU/VibeCoding#3532 upstream.\n";
  assertEquals(findPrivateRepoReferences(src), [1]);
});

Deno.test("findPrivateRepoReferences flags a private-repo blob link", () => {
  const src =
    "see https://github.com/stSoftwareAU/GRQ-cluster/blob/main/network.json here.\n";
  assertEquals(findPrivateRepoReferences(src), [1]);
});

Deno.test("findPrivateRepoReferences ignores the public NEAT-AI repo", () => {
  const src =
    "Filed at https://github.com/stSoftwareAU/NEAT-AI/issues/2575 (public).\n";
  assertEquals(findPrivateRepoReferences(src), []);
});

Deno.test("findPrivateRepoReferences ignores the lower-case grq-3397 fixture", () => {
  const src =
    "The synthetic `grq-3397` scale preset reproduces the dimensions.\n";
  assertEquals(findPrivateRepoReferences(src), []);
});

Deno.test("findPrivateRepoReferences returns empty for concept-level prose", () => {
  const src = [
    "A cross-repo issue in the downstream production repo carries the action.",
    "The production `network.json` snapshot is far larger than the old claim.",
  ].join("\n");
  assertEquals(findPrivateRepoReferences(src), []);
});

Deno.test("findPrivateRepoReferences returns empty for empty input", () => {
  assertEquals(findPrivateRepoReferences(""), []);
});
