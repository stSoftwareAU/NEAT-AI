/**
 * Issue #3455 — archived documentation must stay self-contained for public
 * readers and must not link or slug the private `stSoftwareAU` repositories
 * `GRQ`, `GRQ-cluster` or `VibeCoding`.
 *
 * Archived PR summaries and investigations ship in every public clone. A line
 * that links a private repo (the link 404s) or carries a private issue-tracker
 * slug (`GRQ#3472`, `stSoftwareAU/VibeCoding#3532`) points readers at issues
 * and files they cannot open. The archived narrative keeps its meaning when the
 * reference is reworded to concept level (e.g. "the downstream production
 * repo"), so this guard walks the previously-offending archived docs and fails
 * if any reintroduces a private-repo link or slug. It exercises behaviour (doc
 * content), not the source text of any function.
 *
 * Bare host/log/preset **mnemonics** with no issue slug or org prefix
 * (`GRQ-21`, `GRQ-side`, the lower-case `grq-3397` fixture) are intentionally
 * NOT flagged — they name a concept, not a private target, consistent with the
 * #3454 decision to keep such mnemonics. The public `stSoftwareAU/NEAT-AI` repo
 * is likewise not flagged.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/** Archived docs reworded by #3455; each must stay free of private-repo refs. */
const ARCHIVE_DOCS = [
  "../../docs/archive/pr-summaries/pr-summary-3018.md",
  "../../docs/archive/pr-summaries/pr-summary-3400.md",
  "../../docs/archive/pr-summaries/pr-summary-3410.md",
  "../../docs/archive/pr-summaries/pr-summary-3412.md",
  "../../docs/archive/pr-summaries/pr-summary-3417.md",
  "../../docs/archive/investigations/issue-2515-forward-only-apply-audit.md",
];

/**
 * Match a reference to a private `stSoftwareAU` repository:
 *
 * - an issue-tracker slug — `GRQ#3472`, `stSoftwareAU/VibeCoding#3532`;
 * - an org-qualified private repo name — `stSoftwareAU/GRQ`,
 *   `stSoftwareAU/GRQ-cluster`, `stSoftwareAU/VibeCoding` (this also covers a
 *   `github.com/stSoftwareAU/GRQ-cluster/...` link).
 *
 * The public `stSoftwareAU/NEAT-AI` repo and bare mnemonics (`GRQ-21`,
 * `grq-3397`) do not match.
 */
const PRIVATE_REPO_PATTERN =
  /(?:^|[^A-Za-z0-9])(?:GRQ|VibeCoding)#\d+|stSoftwareAU\/(?:GRQ|VibeCoding)/;

/**
 * Return every 1-indexed line number carrying a private-repo issue slug or an
 * org-qualified private-repo reference.
 *
 * @param source raw Markdown source
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

for (const rel of ARCHIVE_DOCS) {
  Deno.test(`archived doc ${rel} has no private-repo reference (#3455)`, async () => {
    const path = fromFileUrl(new URL(rel, import.meta.url));
    const source = await Deno.readTextFile(path);
    const hits = findPrivateRepoRefs(source);
    assertEquals(
      hits,
      [],
      `${rel} references a private stSoftwareAU repository on line(s) ` +
        `${hits.join(", ")}. Reword to concept level (e.g. "the downstream ` +
        `production repo") so the archived doc stays verifiable by public ` +
        `readers.`,
    );
  });
}

Deno.test("findPrivateRepoRefs flags a bare GRQ# issue slug", () => {
  const src = [
    "Intro line.",
    "reducing popSize (GRQ#3472 keeps population = 20).",
    "Closing line.",
  ].join("\n");
  assertEquals(findPrivateRepoRefs(src), [2]);
});

Deno.test("findPrivateRepoRefs flags an org-qualified GRQ# slug", () => {
  const src = "handed to the repo (stSoftwareAU/GRQ#3472) with the tool.\n";
  assertEquals(findPrivateRepoRefs(src), [1]);
});

Deno.test("findPrivateRepoRefs flags a VibeCoding# slug", () => {
  const src = "tracked separately as stSoftwareAU/VibeCoding#3532 upstream.\n";
  assertEquals(findPrivateRepoRefs(src), [1]);
});

Deno.test("findPrivateRepoRefs flags an org-qualified private repo name", () => {
  const src = "Statistics parsed from stSoftwareAU/GRQ-cluster network.json.\n";
  assertEquals(findPrivateRepoRefs(src), [1]);
});

Deno.test("findPrivateRepoRefs flags a private-repo blob URL", () => {
  const src =
    "([network.json](https://github.com/stSoftwareAU/GRQ-cluster/blob/main/network.json))\n";
  assertEquals(findPrivateRepoRefs(src), [1]);
});

Deno.test("findPrivateRepoRefs ignores bare host/log/preset mnemonics", () => {
  const src = [
    "On GRQ-21 the 4373 MB V8 limit was misread.",
    "The production-scale grq-3397 topology (seed 3396).",
    "The downstream GRQ-side defences become defence-in-depth.",
    "GRQ-3-rocket.log signature (output-0 self-loops).",
  ].join("\n");
  assertEquals(findPrivateRepoRefs(src), []);
});

Deno.test("findPrivateRepoRefs ignores the public NEAT-AI repo", () => {
  const src =
    "See https://github.com/stSoftwareAU/NEAT-AI/issues/2575 for context.\n";
  assertEquals(findPrivateRepoRefs(src), []);
});

Deno.test("findPrivateRepoRefs returns empty for concept-level prose", () => {
  const src = [
    "A cross-repo issue was raised in the downstream production repo.",
    "The orchestration repo's tracking issue carries the worker fix.",
  ].join("\n");
  assertEquals(findPrivateRepoRefs(src), []);
});

Deno.test("findPrivateRepoRefs returns empty for empty input", () => {
  assertEquals(findPrivateRepoRefs(""), []);
});
