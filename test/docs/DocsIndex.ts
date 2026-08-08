/**
 * Issue #2566 — verifies the docs navigation foundation behaviourally:
 * every relative link in `docs/README.md` resolves to a file on disk.
 *
 * Issue #3142 — the prose-grep assertions that previously lived here
 * (content-length thresholds, topic-heading wording, acronym expansions,
 * "where to start" phrasing, ```mermaid``` fences, and hard-coded
 * substring coverage of doc names) were removed. They asserted on the
 * *prose* of committed Markdown rather than on observable behaviour, so
 * they broke on any editorial reword even when nothing a reader could
 * observe had changed. Heading wording, acronym tables and Mermaid fences
 * are editorial conventions enforced by the Markdown linter
 * (`.markdownlint-cli2.jsonc`), not by substring tests in the unit-test
 * runner. The one behaviour worth guarding — links resolve — is kept
 * below as a "what" test: it reads the actual link targets and asserts the
 * referenced files exist.
 */

import { assert } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs");
const DOCS_INDEX = join(DOCS_DIR, "README.md");

/** Relative link targets (no http(s), no bare anchors) found in `content`. */
function linkTargets(content: string): string[] {
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

Deno.test("docs/README.md internal links resolve", async () => {
  const content = await Deno.readTextFile(DOCS_INDEX);
  const docsDir = dirname(DOCS_INDEX);
  const targets = linkTargets(content);
  // Run filesystem checks in parallel — satisfies no-await-in-loop and is
  // also faster.
  const results = await Promise.all(
    targets.map(async (pathPart) => {
      const resolved = resolve(docsDir, pathPart);
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
    `docs/README.md has broken internal links:\n${failures.join("\n")}`,
  );
});

/**
 * Issue #3691 — the index claims "every long-form guide in the repository has
 * a home here", so the claim is only true while every top-level `docs/*.md`
 * guide is actually linked from it. The out-of-scope section of the index
 * carves out `pr-summary-*.md` and the non-prose subdirectories; nothing else
 * may be silently absent.
 */
Deno.test("docs/README.md indexes every top-level guide", async () => {
  const content = await Deno.readTextFile(DOCS_INDEX);
  const linked = new Set(
    linkTargets(content).map((t) => t.replace(/^\.\//, "")),
  );

  const missing: string[] = [];
  for await (const entry of Deno.readDir(DOCS_DIR)) {
    if (!entry.isFile) continue;
    if (!entry.name.endsWith(".md")) continue;
    if (entry.name === "README.md") continue;
    // Carved out by the index's own "Out of scope" section.
    if (entry.name.startsWith("pr-summary-")) continue;
    if (!linked.has(entry.name)) missing.push(entry.name);
  }

  assert(
    missing.length === 0,
    `docs/README.md omits top-level guide(s), breaking its ` +
      `"every long-form guide has a home here" claim:\n${
        missing.sort().join("\n")
      }`,
  );
});
