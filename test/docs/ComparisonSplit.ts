/**
 * Issue #2961 — verifies COMPARISON.md has been split into a concise hub
 * plus focused topic detail docs under docs/comparison/.
 *
 *   1. COMPARISON.md is now a short hub (<= 320 lines).
 *   2. The hub links to every topic detail doc under docs/comparison/.
 *   3. The hub carries a comparison table and at least one Mermaid diagram.
 *   4. The hub makes the NEAT-AI-vs-standard-NEAT distinction explicit and
 *      links to the canonical NEAT-vs-NEAT-AI rule in AGENTS.md.
 *   5. Each topic detail doc exists, is non-trivial, and has a heading.
 *   6. All relative links in the hub and detail docs resolve on disk.
 *   7. docs/README.md still references COMPARISON.md.
 *
 * These are "what" tests: they read the actual files and assert on outcomes
 * (links resolve, sections exist), not on implementation details such as
 * exact wording.
 */

import { assert } from "@std/assert";
import { dirname, fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const HUB = `${REPO_ROOT}/COMPARISON.md`;
const COMPARISON_DIR = `${REPO_ROOT}/docs/comparison`;
const DOCS_README = `${REPO_ROOT}/docs/README.md`;

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

Deno.test("COMPARISON.md is a concise hub (<= 320 lines)", async () => {
  const content = await Deno.readTextFile(HUB);
  const lineCount = content.split("\n").length;
  assert(
    lineCount <= 320,
    `COMPARISON.md must be a concise hub (<= 320 lines), got ${lineCount}`,
  );
});

Deno.test("COMPARISON.md links to every topic detail doc", async () => {
  const content = await Deno.readTextFile(HUB);
  for (const doc of TOPIC_DOCS) {
    assert(
      content.includes(`docs/comparison/${doc}`),
      `COMPARISON.md must link to docs/comparison/${doc}`,
    );
  }
});

Deno.test("COMPARISON.md carries a comparison table and a Mermaid diagram", async () => {
  const content = await Deno.readTextFile(HUB);
  assert(
    content.includes("```mermaid"),
    "COMPARISON.md must contain at least one fenced ```mermaid block",
  );
  // A Markdown table uses a header separator row of pipes and dashes.
  assert(
    /\|\s*-{2,}/.test(content),
    "COMPARISON.md must contain at least one Markdown comparison table",
  );
});

Deno.test("COMPARISON.md makes NEAT-AI vs standard NEAT explicit", async () => {
  const content = await Deno.readTextFile(HUB);
  assert(
    content.includes("NEAT-AI ≠ NEAT"),
    "COMPARISON.md must carry the NEAT-AI ≠ NEAT callout",
  );
  assert(
    content.includes("-neat-vs-neat-ai--which-term-to-use"),
    "COMPARISON.md must link to the canonical NEAT-vs-NEAT-AI rule in AGENTS.md",
  );
});

Deno.test("Each comparison detail doc exists and is non-trivial", async () => {
  const docs = await Promise.all(
    TOPIC_DOCS.map(async (doc) => {
      const path = `${COMPARISON_DIR}/${doc}`;
      const content = await Deno.readTextFile(path);
      return { path, content };
    }),
  );
  for (const { path, content } of docs) {
    assert(
      content.length > 500,
      `${path} must be substantive (>500 chars), got ${content.length}`,
    );
    assert(
      /^#\s|\n#\s|\n##\s/.test(content),
      `${path} must contain at least one Markdown heading`,
    );
  }
});

Deno.test("COMPARISON.md relative links resolve", async () => {
  const content = await Deno.readTextFile(HUB);
  await assertLinksResolve(content, dirname(HUB));
});

Deno.test("Comparison detail docs relative links resolve", async () => {
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

Deno.test("docs/README.md still indexes COMPARISON.md and the sub-docs", async () => {
  const content = await Deno.readTextFile(DOCS_README);
  assert(
    content.includes("COMPARISON.md"),
    "docs/README.md must continue to reference COMPARISON.md",
  );
  assert(
    content.includes("comparison/"),
    "docs/README.md must reference the docs/comparison/ sub-docs",
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
