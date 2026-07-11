/**
 * Issue #3288 — the README must maintain a single "Docs map" pointer that
 * defers to the canonical documentation index in `docs/README.md`, rather
 * than re-implementing the catalogue inline.
 *
 * Before this issue the README carried TWO overlapping documentation
 * indexes ("## 📖 Docs map" and "## 📚 Documentation") that duplicated
 * `docs/README.md` and had already drifted out of sync. Three parallel
 * indexes of the same guides cannot stay consistent.
 *
 * These are behavioural ("what") tests: they read the actual link targets
 * and section structure of the committed Markdown and assert on observable
 * facts (links resolve; the canonical index is referenced; the second
 * catalogue is gone; the README is a pointer, not a duplicate catalogue).
 */

import { assert } from "@std/assert";
import { dirname, fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const README = `${REPO_ROOT}/README.md`;
const DOCS_README = `${REPO_ROOT}/docs/README.md`;

/** Extract the resolvable relative-link targets from Markdown content. */
function relativeLinkTargets(content: string): string[] {
  const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
  const targets: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(content)) !== null) {
    const target = match[1];
    if (target.startsWith("http://") || target.startsWith("https://")) continue;
    if (target.startsWith("#")) continue;
    const [pathPart] = target.split("#");
    if (!pathPart) continue;
    targets.push(pathPart);
  }
  return targets;
}

/** Return the body of the `## `-level section whose heading includes `needle`. */
function sectionBody(content: string, needle: string): string | null {
  const lines = content.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("## ") && lines[i].includes(needle)) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

Deno.test("README relative links all resolve on disk", async () => {
  const content = await Deno.readTextFile(README);
  const targets = relativeLinkTargets(content);
  const failures = await Promise.all(
    targets.map(async (pathPart) => {
      const resolved = resolve(dirname(README), pathPart);
      try {
        await Deno.stat(resolved);
        return null;
      } catch {
        return `broken link: ${pathPart} (resolved to ${resolved})`;
      }
    }),
  );
  const broken = failures.filter((r): r is string => r !== null);
  assert(broken.length === 0, `README has broken links:\n${broken.join("\n")}`);
});

Deno.test("README defers to the canonical docs/README.md index", async () => {
  const content = await Deno.readTextFile(README);
  const docsMap = sectionBody(content, "Docs map");
  assert(
    docsMap !== null,
    "README must keep a single '## 📖 Docs map' section",
  );
  assert(
    docsMap.includes("docs/README.md"),
    "the Docs map must link to the canonical docs/README.md index",
  );
});

Deno.test("README no longer carries a second '## 📚 Documentation' catalogue", async () => {
  const content = await Deno.readTextFile(README);
  const duplicate = sectionBody(content, "📚 Documentation");
  assert(
    duplicate === null,
    "README must not re-implement a second documentation catalogue; the " +
      "canonical index lives in docs/README.md",
  );
});

Deno.test("README Docs map is a pointer, not a duplicate catalogue", async () => {
  const [readme, docsIndex] = await Promise.all([
    Deno.readTextFile(README),
    Deno.readTextFile(DOCS_README),
  ]);

  // Count distinct long-form guides under docs/ that each file links to,
  // excluding the canonical index and the glossary/style foundation docs
  // that are legitimate top entry points from the README.
  const foundation = new Set(["README.md", "GLOSSARY.md", "DOC_STYLE.md"]);
  const guidesLinked = (content: string): Set<string> => {
    const guides = new Set<string>();
    for (const target of relativeLinkTargets(content)) {
      const m = target.match(/(?:^|\/)docs\/([^/]+\.md)$/) ??
        target.match(/^([A-Z0-9_]+\.md)$/); // docs/README.md's own relative form
      if (!m) continue;
      const file = m[1];
      if (foundation.has(file)) continue;
      guides.add(file);
    }
    return guides;
  };

  const readmeGuides = guidesLinked(readme);
  const docsGuides = guidesLinked(docsIndex);

  // The README must be a short pointer: it should not re-catalogue the bulk
  // of the topic guides that docs/README.md owns. A handful of contextual
  // links inside feature prose is fine; a parallel catalogue is not.
  assert(
    readmeGuides.size < docsGuides.size,
    `README links to ${readmeGuides.size} docs/ guides but the canonical ` +
      `index links to ${docsGuides.size}; the README must defer the ` +
      `catalogue to docs/README.md, not duplicate it`,
  );
});
