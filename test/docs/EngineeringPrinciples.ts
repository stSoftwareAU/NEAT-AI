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
import { relativeLinks, relativeLinkTargets } from "./_markdownLinks.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs");
const PRINCIPLES = join(DOCS_DIR, "ENGINEERING_PRINCIPLES.md");
const DOCS_INDEX = join(DOCS_DIR, "README.md");

/** Entry points that must send their reader to the canonical policy (#3979). */
const ENTRY_POINTS: ReadonlyArray<[label: string, path: string]> = [
  ["AGENTS.md", join(REPO_ROOT, "AGENTS.md")],
  ["CONTRIBUTING.md", join(REPO_ROOT, "CONTRIBUTING.md")],
];

/**
 * Migration, parity and dependency documents that keep their own mechanics but
 * cite the canonical policy rather than restating it (Issue #3980).
 */
const POLICY_CONSUMERS: ReadonlyArray<[label: string, path: string]> = [
  [
    "docs/CORE_DEPENDENCY_POLICY.md",
    join(DOCS_DIR, "CORE_DEPENDENCY_POLICY.md"),
  ],
  ["docs/PARITY_GATE.md", join(DOCS_DIR, "PARITY_GATE.md")],
  ["docs/TS_RUST_MIGRATION.md", join(DOCS_DIR, "TS_RUST_MIGRATION.md")],
];

/** Documents whose relative links must all resolve on disk. */
const LINK_CHECKED: ReadonlyArray<[label: string, path: string]> = [
  ["docs/ENGINEERING_PRINCIPLES.md", PRINCIPLES],
  ...POLICY_CONSUMERS,
];

/** True when `content` links to `target`, however the link spells the path. */
function linksTo(content: string, target: string): boolean {
  return relativeLinkTargets(content)
    .some((linked) => linked.replace(/^\.\//, "").endsWith(target));
}

/** Relative link targets in `content` that do not resolve on disk. */
async function brokenLinks(
  content: string,
  baseDir: string,
): Promise<string[]> {
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
  return results.filter((r): r is string => r !== null);
}

/**
 * GitHub's heading-anchor slug: inline links reduced to their text, then
 * lower-cased, punctuation and emoji dropped, spaces turned into hyphens.
 */
function headingSlug(heading: string): string {
  return heading
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}_ -]/gu, "")
    .trim()
    .replace(/ /g, "-");
}

/** The anchors a reader can actually jump to in `markdown`. */
function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of markdown.split("\n")) {
    const match = /^#{1,6} +(.*)$/.exec(line);
    if (match) anchors.add(headingSlug(match[1]));
  }
  return anchors;
}

/** Every committed Markdown file that could cite a principle by anchor. */
async function markdownFiles(): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string) => {
    for await (const entry of Deno.readDir(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory) await walk(path);
      else if (entry.name.endsWith(".md")) found.push(path);
    }
  };
  await walk(DOCS_DIR);
  for await (const entry of Deno.readDir(REPO_ROOT)) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      found.push(join(REPO_ROOT, entry.name));
    }
  }
  return found;
}

Deno.test("docs/ENGINEERING_PRINCIPLES.md exists and is non-empty", async () => {
  const content = await Deno.readTextFile(PRINCIPLES);
  assert(
    content.trim().length > 0,
    "the canonical engineering-principles document must not be empty",
  );
});

for (const [label, path] of LINK_CHECKED) {
  Deno.test(`${label} internal links resolve`, async () => {
    const content = await Deno.readTextFile(path);
    const failures = await brokenLinks(content, dirname(path));
    assert(
      failures.length === 0,
      `${label} has broken internal links:\n${failures.join("\n")}`,
    );
  });
}

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

for (const [label, path] of POLICY_CONSUMERS) {
  Deno.test(`${label} defers to the canonical engineering principles`, async () => {
    const content = await Deno.readTextFile(path);
    assert(
      linksTo(content, "ENGINEERING_PRINCIPLES.md"),
      `${label} must link to ENGINEERING_PRINCIPLES.md: the family-wide ` +
        "migration, fallback and rollback rules are defined once there, and " +
        "this document carries only the mechanics specific to its purpose",
    );
  });
}

Deno.test("every document that cites a principle cites one that exists", async () => {
  const anchors = headingAnchors(await Deno.readTextFile(PRINCIPLES));
  const dangling: string[] = [];
  for (const path of await markdownFiles()) {
    for (const link of relativeLinks(await Deno.readTextFile(path))) {
      if (!link.path.endsWith("ENGINEERING_PRINCIPLES.md")) continue;
      if (link.fragment === "" || anchors.has(link.fragment)) continue;
      dangling.push(`${path}: #${link.fragment}`);
    }
  }
  assert(
    dangling.length === 0,
    "these documents cite principles that no longer exist in " +
      `docs/ENGINEERING_PRINCIPLES.md:\n${dangling.join("\n")}`,
  );
});
