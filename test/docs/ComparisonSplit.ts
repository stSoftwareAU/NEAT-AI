/**
 * Issue #2961 — verifies COMPARISON.md has been split into a concise hub
 * plus focused topic detail docs under docs/comparison/.
 *
 * The behaviour worth guarding is that the split docs still exist and
 * their relative links resolve on disk:
 *
 *   1. Every relative link in COMPARISON.md resolves.
 *   2. Each topic detail doc under docs/comparison/ exists (it is read)
 *      and its relative links resolve.
 *
 * Issue #3142 — the prose-grep assertions that previously lived here (a
 * `<= 320` line-count cap, hard-coded link-substring coverage, a
 * ```mermaid``` fence, a comparison-table regex, a `content.length > 500`
 * threshold, a heading regex, and `NEAT-AI ≠ NEAT` callout wording) were
 * removed. They asserted on the *prose* and *length* of committed Markdown
 * rather than on observable behaviour, so they broke on any reword,
 * reflow, or trim even when nothing observable had changed. Line counts
 * and length are not behaviours; heading style, table formatting and
 * Mermaid fences are editorial conventions enforced by the Markdown linter
 * (`.markdownlint-cli2.jsonc`). The link-resolution checks below are "what"
 * tests: each topic detail doc is read (so its absence fails the test) and
 * every relative link target is asserted to exist on disk.
 */

import { assert } from "@std/assert";
import { dirname, fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const HUB = `${REPO_ROOT}/COMPARISON.md`;
const COMPARISON_DIR = `${REPO_ROOT}/docs/comparison`;

// Topic detail docs that must live under docs/comparison/.
const TOPIC_DOCS: ReadonlyArray<string> = [
  "IMPLEMENTED.md",
  "ARCHITECTURES.md",
  "TRAINING_PARADIGMS.md",
  "UNIQUE_APPROACHES.md",
  "ECOSYSTEM.md",
  "PROS_AND_CONS.md",
  "FUTURE_WORK.md",
  "REFERENCES.md",
];

Deno.test("COMPARISON.md relative links resolve", async () => {
  const content = await Deno.readTextFile(HUB);
  await assertLinksResolve(content, dirname(HUB));
});

Deno.test("Comparison detail docs exist and their relative links resolve", async () => {
  // Reading each detail doc asserts its existence behaviourally — a missing
  // file makes readTextFile throw and fails the test.
  const docs = await Promise.all(
    TOPIC_DOCS.map(async (doc) => {
      const path = `${COMPARISON_DIR}/${doc}`;
      const content = await Deno.readTextFile(path);
      return { path, content };
    }),
  );
  await Promise.all(
    docs.map(({ path, content }) => assertLinksResolve(content, dirname(path))),
  );
});

async function assertLinksResolve(content: string, baseDir: string) {
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
  const failures = await Promise.all(
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
  const broken = failures.filter((r): r is string => r !== null);
  assert(broken.length === 0, `broken links:\n${broken.join("\n")}`);
}
