/**
 * Issue #3455 — archived documentation must stay self-contained for public
 * readers.
 *
 * A public repository is fully self-contained for the public. Archived PR
 * summaries and investigations ship in every public clone, so a line that
 * points at a private `stSoftwareAU` repository — an issue-tracker slug or an
 * org-qualified repo path / blob link — sends the reader to a page they cannot
 * open. The archived narrative keeps its meaning when reworded to concept
 * level (e.g. "the downstream production repo", "the orchestration repo's
 * tracking issue").
 *
 * This test walks the real `docs/archive/` tree and fails if any Markdown file
 * reintroduces a private-repo reference. It exercises behaviour (committed
 * file content), not the source text of any function. Detection itself lives
 * in `test/_privateRepoRefs.ts` and is unit-tested by
 * `test/docs/PrivateRepoRefScanner.ts` (Issue #3604).
 */

import { assertEquals } from "@std/assert";
import { basename, fromFileUrl } from "@std/path";
import { walk } from "@std/fs";
import { scanForPrivateRepoRefs } from "../_privateRepoRefs.ts";

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

Deno.test("no private stSoftwareAU repo slugs or links in docs/archive (#3455)", async () => {
  const paths: string[] = [];
  for await (
    const entry of walk(ARCHIVE_DIR, { exts: [".md"], includeDirs: false })
  ) {
    if (AUDIT_NARRATIVE_DOCS.has(basename(entry.path))) continue;
    paths.push(entry.path);
  }
  const offenders = scanForPrivateRepoRefs(paths);
  assertEquals(
    offenders,
    [],
    `Found private stSoftwareAU repo slugs or links in archived docs:\n` +
      `${offenders.join("\n")}\n` +
      `Reword to concept level (e.g. "the downstream production repo") so the ` +
      `archive stays verifiable by public readers.`,
  );
});
