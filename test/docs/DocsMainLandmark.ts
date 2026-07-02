/**
 * Issue #3186 — accessibility guard for the docs HTML pages.
 *
 * Each documentation page must expose exactly one `<main>` landmark so that
 * assistive-technology users can jump straight to the primary content (bucket
 * guide check 6). These are "what" tests: they read the actual committed HTML
 * and assert on its landmark structure, not on incidental source wording.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs");

const PAGES = [
  "index.html",
  join("visualize", "bar_chart.html"),
  join("visualize", "concentric_chart.html"),
];

/** Count non-overlapping matches of a global regex in a string. */
function count(haystack: string, re: RegExp): number {
  return (haystack.match(re) ?? []).length;
}

for (const page of PAGES) {
  Deno.test(`docs/${page} exposes exactly one <main> landmark`, async () => {
    const html = await Deno.readTextFile(join(DOCS_DIR, page));
    // Match opening `<main` (with optional attributes) and closing `</main>`.
    const opening = count(html, /<main(?=[\s>])/gi);
    const closing = count(html, /<\/main\s*>/gi);
    assertEquals(
      opening,
      1,
      `expected exactly one <main> opening tag in docs/${page}, found ${opening}`,
    );
    assertEquals(
      closing,
      1,
      `expected exactly one </main> closing tag in docs/${page}, found ${closing}`,
    );
    // The <main> must wrap real content, not be empty.
    const mainBody = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? "";
    assert(
      mainBody.trim().length > 0,
      `<main> landmark in docs/${page} must wrap content`,
    );
  });
}
