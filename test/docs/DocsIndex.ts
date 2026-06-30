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
const DOCS_INDEX = join(REPO_ROOT, "docs", "README.md");

Deno.test("docs/README.md internal links resolve", async () => {
  const content = await Deno.readTextFile(DOCS_INDEX);
  // Match markdown links of the form [text](path). Skip http(s):// links and
  // pure anchor links (#fragment).
  const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
  const docsDir = dirname(DOCS_INDEX);
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
