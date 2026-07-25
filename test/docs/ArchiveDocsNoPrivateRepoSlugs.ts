/**
 * Issue #3455 — archived documentation must stay self-contained for public
 * readers.
 *
 * A public repository is fully self-contained for the public. Archived PR
 * summaries and investigations ship in every public clone, so a line that
 * points at a private `stSoftwareAU` repository — an issue-tracker slug
 * (`GRQ#3472`, `stSoftwareAU/VibeCoding#3532`) or an org-qualified repo path /
 * blob link (`stSoftwareAU/GRQ-cluster`,
 * `github.com/stSoftwareAU/GRQ-cluster/...`) — sends the reader to a page they
 * cannot open. The archived narrative keeps its meaning when reworded to
 * concept level (e.g. "the downstream production repo", "the orchestration
 * repo's tracking issue").
 *
 * This test walks the real `docs/archive/` tree and fails if any Markdown file
 * reintroduces a private-repo slug or link. It exercises behaviour (committed
 * file content), not the source text of any function.
 */

import { assertEquals } from "@std/assert";
import { basename, fromFileUrl } from "@std/path";
import { walk } from "@std/fs";

const ARCHIVE_DIR = fromFileUrl(new URL("../../docs/archive", import.meta.url));

/**
 * Audit-narrative PR summaries that document the private-repo-reference cleanup
 * itself. They must embed the forbidden slugs/paths verbatim to record *what*
 * was removed, so scanning them would be a self-referential false positive —
 * they are the audit, not offenders. Any new summary that necessarily cites the
 * private-repo patterns it removes belongs here.
 */
const AUDIT_NARRATIVE_DOCS = new Set([
  "pr-summary-3452.md",
  "pr-summary-3454.md",
  "pr-summary-3455.md",
]);

/**
 * Match a private `stSoftwareAU` issue-tracker slug (`GRQ#3472`,
 * `VibeCoding#3532`) or an org-qualified private repo path / blob link
 * (`stSoftwareAU/GRQ-cluster`, `github.com/stSoftwareAU/GRQ-cluster/...`).
 */
const PRIVATE_REPO_PATTERN =
  /GRQ#\d+|VibeCoding#\d+|stSoftwareAU\/GRQ-cluster|github\.com\/stSoftwareAU\/(?:GRQ|VibeCoding)/;

/**
 * Return every 1-indexed line number carrying a private-repo issue slug or
 * org-qualified repo path/link.
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

Deno.test("no private stSoftwareAU repo slugs or links in docs/archive (#3455)", async () => {
  const offenders: string[] = [];
  for await (
    const entry of walk(ARCHIVE_DIR, { exts: [".md"], includeDirs: false })
  ) {
    if (AUDIT_NARRATIVE_DOCS.has(basename(entry.path))) continue;
    const source = await Deno.readTextFile(entry.path);
    const hits = findPrivateRepoRefs(source);
    if (hits.length > 0) {
      offenders.push(`${entry.path}:${hits.join(",")}`);
    }
  }
  assertEquals(
    offenders,
    [],
    `Found private stSoftwareAU repo slugs or links in archived docs:\n` +
      `${offenders.join("\n")}\n` +
      `Reword to concept level (e.g. "the downstream production repo") so the ` +
      `archive stays verifiable by public readers.`,
  );
});

Deno.test("findPrivateRepoRefs flags a bare GRQ# issue slug", () => {
  const src = [
    "Intro line.",
    "reducing `popSize` (GRQ#3472 keeps population = 20).",
    "Closing line.",
  ].join("\n");
  assertEquals(findPrivateRepoRefs(src), [2]);
});

Deno.test("findPrivateRepoRefs flags an org-qualified GRQ# slug", () => {
  const src = "handed to GRQ (stSoftwareAU/GRQ#3472) with the reusable tool.\n";
  assertEquals(findPrivateRepoRefs(src), [1]);
});

Deno.test("findPrivateRepoRefs flags a VibeCoding# slug", () => {
  const src = "tracked separately as `stSoftwareAU/VibeCoding#3532`.\n";
  assertEquals(findPrivateRepoRefs(src), [1]);
});

Deno.test("findPrivateRepoRefs flags an org-qualified GRQ-cluster path", () => {
  const src = "statistics derived from `stSoftwareAU/GRQ-cluster`.\n";
  assertEquals(findPrivateRepoRefs(src), [1]);
});

Deno.test("findPrivateRepoRefs flags a GRQ-cluster blob link", () => {
  const src =
    "([net](https://github.com/stSoftwareAU/GRQ-cluster/blob/main/network.json))\n";
  assertEquals(findPrivateRepoRefs(src), [1]);
});

Deno.test("findPrivateRepoRefs returns empty for concept-level prose", () => {
  const src = [
    "The production `network.json` snapshot is far larger than the docs claimed.",
    "A cross-repo issue in the downstream production repo carries the action.",
    "The GRQ-23 host snapshot and GRQ-cluster mnemonics stay as narrative.",
  ].join("\n");
  assertEquals(findPrivateRepoRefs(src), []);
});

Deno.test("findPrivateRepoRefs returns empty for empty input", () => {
  assertEquals(findPrivateRepoRefs(""), []);
});
