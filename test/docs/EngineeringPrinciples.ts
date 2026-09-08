/**
 * Issue #3978 — `docs/ENGINEERING_PRINCIPLES.md` is the canonical, family-wide
 * engineering policy read by human contributors and coding agents alike.
 *
 * These are behavioural ("what") tests in the style of
 * `test/docs/DocsIndex.ts` and `test/docs/ReadmeSingleDocsIndex.ts`: they read
 * the committed Markdown's actual link targets and assert observable facts —
 * the canonical document exists, every relative link it makes resolves on
 * disk, and the documentation index points at it. They deliberately do **not**
 * grep the prose: wording is editorial and is enforced by the Markdown linter,
 * not by substring assertions (Issue #3142).
 */

import { assert } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { relativeLinkTargets } from "./_markdownLinks.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs");
const PRINCIPLES = join(DOCS_DIR, "ENGINEERING_PRINCIPLES.md");
const DOCS_INDEX = join(DOCS_DIR, "README.md");

/** Entry points that must send their reader to the canonical policy (#3979). */
const ENTRY_POINTS: ReadonlyArray<[label: string, path: string]> = [
  ["AGENTS.md", join(REPO_ROOT, "AGENTS.md")],
  ["CONTRIBUTING.md", join(REPO_ROOT, "CONTRIBUTING.md")],
];

Deno.test("docs/ENGINEERING_PRINCIPLES.md exists and is non-empty", async () => {
  const content = await Deno.readTextFile(PRINCIPLES);
  assert(
    content.trim().length > 0,
    "the canonical engineering-principles document must not be empty",
  );
});

Deno.test("docs/ENGINEERING_PRINCIPLES.md internal links resolve", async () => {
  const content = await Deno.readTextFile(PRINCIPLES);
  const baseDir = dirname(PRINCIPLES);
  const results = await Promise.all(
    relativeLinkTargets(content).map(async (pathPart) => {
      const resolved = resolve(baseDir, pathPart);
      try {
        await Deno.stat(resolved);
        return null;
      } catch {
        return `broken link: ${pathPart} (resolved to ${resolved})`;
      }
    }),
  );
  const failures = results.filter((r): r is string => r !== null);
  assert(
    failures.length === 0,
    `docs/ENGINEERING_PRINCIPLES.md has broken internal links:\n${
      failures.join("\n")
    }`,
  );
});

Deno.test("docs index links to the canonical engineering principles", async () => {
  const content = await Deno.readTextFile(DOCS_INDEX);
  const linked = relativeLinkTargets(content).map((t) =>
    t.replace(/^\.\//, "")
  );
  assert(
    linked.includes("ENGINEERING_PRINCIPLES.md"),
    "docs/README.md must link to ENGINEERING_PRINCIPLES.md so readers have " +
      "one obvious place to find the family engineering principles",
  );
});

for (const [label, path] of ENTRY_POINTS) {
  Deno.test(`${label} links to the canonical engineering principles`, async () => {
    const content = await Deno.readTextFile(path);
    const linked = relativeLinkTargets(content).map((t) =>
      t.replace(/^\.\//, "")
    );
    assert(
      linked.includes("docs/ENGINEERING_PRINCIPLES.md"),
      `${label} must link to docs/ENGINEERING_PRINCIPLES.md so its reader — ` +
        "human or agent — arrives at the same shared engineering policy " +
        "instead of a repository-local copy of it",
    );
  });
}
