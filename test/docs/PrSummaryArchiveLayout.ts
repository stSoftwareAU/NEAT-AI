/**
 * Issue #2958 — per-PR summary files must live under
 * `docs/archive/pr-summaries/`, never at the `docs/` root.
 *
 * The repository previously carried ~696 obsolete `pr-summary-*.md` files
 * (199 at the `docs/` root, ~497 in the archive). They are noise in the
 * working tree and remain permanently available in GitHub's PR history, so
 * the historical copies were deleted. The canonical home for any future PR
 * summary is `docs/archive/pr-summaries/` (Issue #2173).
 *
 * This is a "what" test: it walks the real filesystem and asserts on the
 * outcome (no stray `pr-summary-*.md` at the `docs/` root, archive directory
 * still present), not on implementation details.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const DOCS_DIR = join(REPO_ROOT, "docs");
const ARCHIVE_DIR = join(DOCS_DIR, "archive", "pr-summaries");

Deno.test("docs/ root carries no pr-summary-*.md files (#2173, #2958)", async () => {
  const stray: string[] = [];
  for await (const entry of Deno.readDir(DOCS_DIR)) {
    if (
      entry.isFile && entry.name.startsWith("pr-summary-") &&
      entry.name.endsWith(".md")
    ) {
      stray.push(entry.name);
    }
  }
  assertEquals(
    stray.length,
    0,
    `pr-summary-*.md files must live under docs/archive/pr-summaries/, not ` +
      `the docs/ root. Stray files: ${stray.join(", ")}`,
  );
});

Deno.test("docs/archive/pr-summaries/ directory is preserved (#2958)", async () => {
  const info = await Deno.stat(ARCHIVE_DIR);
  assert(
    info.isDirectory,
    "docs/archive/pr-summaries/ must remain as the canonical home for PR summaries",
  );
});
