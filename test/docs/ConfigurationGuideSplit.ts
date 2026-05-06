/**
 * Issue #2573 — verifies docs/CONFIGURATION_GUIDE.md has been split into a
 * short index plus topic detail docs under docs/config/.
 *
 *   1. docs/CONFIGURATION_GUIDE.md is now a short index (<= 300 lines).
 *   2. The index links to every topic detail doc under docs/config/.
 *   3. Each topic detail doc exists and is non-trivial.
 *   4. All relative links in the index and detail docs resolve on disk.
 *   5. docs/README.md still references the configuration guide entry.
 */

import { assert } from "@std/assert";
import { dirname, fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const DOCS_DIR = `${REPO_ROOT}/docs`;
const INDEX = `${DOCS_DIR}/CONFIGURATION_GUIDE.md`;
const CONFIG_DIR = `${DOCS_DIR}/config`;
const DOCS_README = `${DOCS_DIR}/README.md`;

// Topic detail docs that must live under docs/config/.
const TOPIC_DOCS: ReadonlyArray<string> = [
  "PRESETS.md",
  "CORE_EVOLUTION.md",
  "TRAINING.md",
  "DISCOVERY.md",
  "MUTATION_ADAPTATION.md",
  "REGULARISATION.md",
  "POPULATION.md",
  "WORKERS.md",
  "LOGGING.md",
  "RECIPES.md",
];

Deno.test("CONFIGURATION_GUIDE is a short index (<= 300 lines)", async () => {
  const content = await Deno.readTextFile(INDEX);
  const lineCount = content.split("\n").length;
  assert(
    lineCount <= 300,
    `docs/CONFIGURATION_GUIDE.md must be <= 300 lines, got ${lineCount}`,
  );
});

Deno.test("CONFIGURATION_GUIDE links to every topic detail doc", async () => {
  const content = await Deno.readTextFile(INDEX);
  for (const doc of TOPIC_DOCS) {
    assert(
      content.includes(`config/${doc}`),
      `docs/CONFIGURATION_GUIDE.md must link to config/${doc}`,
    );
  }
});

Deno.test("Each topic detail doc exists and is non-trivial", async () => {
  // Read all detail docs in parallel to satisfy no-await-in-loop.
  const docs = await Promise.all(
    TOPIC_DOCS.map(async (doc) => {
      const path = `${CONFIG_DIR}/${doc}`;
      const content = await Deno.readTextFile(path);
      return { doc, path, content };
    }),
  );
  for (const { path, content } of docs) {
    assert(
      content.length > 500,
      `${path} must be substantive (>500 chars), got ${content.length}`,
    );
    // Each detail doc must include at least one Markdown heading — i.e. it
    // is real documentation, not a stub.
    assert(
      /^#\s|\n#\s|\n##\s/.test(content),
      `${path} must contain at least one Markdown heading`,
    );
  }
});

Deno.test("Each topic detail doc cross-references performance tuning", async () => {
  const docs = await Promise.all(
    TOPIC_DOCS.map(async (doc) => {
      const path = `${CONFIG_DIR}/${doc}`;
      const content = await Deno.readTextFile(path);
      return { path, content };
    }),
  );
  for (const { path, content } of docs) {
    assert(
      content.includes("PERFORMANCE_TUNING") ||
        content.includes("PERFORMANCE_RESEARCH"),
      `${path} must cross-reference the performance docs`,
    );
  }
});

Deno.test("CONFIGURATION_GUIDE relative links resolve", async () => {
  const content = await Deno.readTextFile(INDEX);
  await assertLinksResolve(content, dirname(INDEX));
});

Deno.test("Topic detail docs relative links resolve", async () => {
  const docs = await Promise.all(
    TOPIC_DOCS.map(async (doc) => {
      const path = `${CONFIG_DIR}/${doc}`;
      const content = await Deno.readTextFile(path);
      return { path, content };
    }),
  );
  // Run link checks in parallel — each call is independent.
  await Promise.all(
    docs.map(({ path, content }) => assertLinksResolve(content, dirname(path))),
  );
});

Deno.test("docs/README.md still indexes the configuration guide", async () => {
  const content = await Deno.readTextFile(DOCS_README);
  assert(
    content.includes("CONFIGURATION_GUIDE.md"),
    "docs/README.md must continue to reference CONFIGURATION_GUIDE.md",
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
