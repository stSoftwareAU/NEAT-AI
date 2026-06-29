/**
 * Issue #2957 — Phase 0 foundation of the documentation audit (#2956).
 *
 * Verifies behaviourally that the two foundation documents
 * (`docs/GLOSSARY.md` and `docs/DOC_STYLE.md`) keep their relative links
 * intact: every in-repo link resolves to a file on disk.
 *
 * Issue #3142 — the prose-grep assertions that previously lived here
 * (content-length thresholds, required acronym expansions, themed-term
 * presence, house-style keyword presence, a ```mermaid``` fence, and
 * hard-coded link-substring checks) were removed. They asserted on the
 * *prose* of committed Markdown rather than on observable behaviour, so a
 * reword, a reformat, or a trim below a length threshold broke the build
 * even though nothing observable had changed. Acronym tables, themed-term
 * wording and Mermaid fences are editorial conventions enforced by the
 * Markdown linter (`.markdownlint-cli2.jsonc`), not by substring tests in
 * the unit-test runner. The link-resolution checks below are "what" tests:
 * they read the actual link targets and assert the referenced files exist.
 */

import { assert } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const GLOSSARY = join(REPO_ROOT, "docs", "GLOSSARY.md");
const DOC_STYLE = join(REPO_ROOT, "docs", "DOC_STYLE.md");

/** Collect resolvable relative-link targets and assert each exists. */
async function assertLinksResolve(file: string): Promise<void> {
  const content = await Deno.readTextFile(file);
  const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
  const baseDir = dirname(file);
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
  const results = await Promise.all(
    targets.map(async (pathPart) => {
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
    `${file} has broken internal links:\n${failures.join("\n")}`,
  );
}

Deno.test("docs/GLOSSARY.md internal links resolve", async () => {
  await assertLinksResolve(GLOSSARY);
});

Deno.test("docs/DOC_STYLE.md internal links resolve", async () => {
  await assertLinksResolve(DOC_STYLE);
});
