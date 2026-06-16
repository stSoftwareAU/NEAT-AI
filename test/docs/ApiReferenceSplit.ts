/**
 * Issue #2967 — verifies docs/API_REFERENCE.md has been fact-checked and split
 * into a short index plus per-surface detail docs under docs/api/.
 *
 *   1. docs/API_REFERENCE.md is now a short index (<= 300 lines).
 *   2. The index links to every per-surface detail doc under docs/api/.
 *   3. Each detail doc exists and is non-trivial.
 *   4. All relative links in the index and detail docs resolve on disk.
 *   5. docs/README.md references the API reference and the docs/api/ split.
 *
 * These are "what" tests: they read the actual files and assert on outcomes
 * (links resolve, sections exist), not on implementation details.
 */

import { assert } from "@std/assert";
import { dirname, fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const DOCS_DIR = `${REPO_ROOT}/docs`;
const INDEX = `${DOCS_DIR}/API_REFERENCE.md`;
const API_DIR = `${DOCS_DIR}/api`;
const DOCS_README = `${DOCS_DIR}/README.md`;

// Per-surface detail docs that must live under docs/api/.
const TOPIC_DOCS: ReadonlyArray<string> = [
  "CREATURE.md",
  "CONFIGURATION.md",
  "COSTS_AND_ACTIVATIONS.md",
  "EVOLUTION.md",
  "TRAINING.md",
  "DISCOVERY.md",
  "INTEROP.md",
  "COMPUTE.md",
  "ERRORS.md",
];

Deno.test("API_REFERENCE is a short index (<= 300 lines)", async () => {
  const content = await Deno.readTextFile(INDEX);
  const lineCount = content.split("\n").length;
  assert(
    lineCount <= 300,
    `docs/API_REFERENCE.md must be <= 300 lines, got ${lineCount}`,
  );
});

Deno.test("API_REFERENCE links to every per-surface detail doc", async () => {
  const content = await Deno.readTextFile(INDEX);
  for (const doc of TOPIC_DOCS) {
    assert(
      content.includes(`api/${doc}`),
      `docs/API_REFERENCE.md must link to api/${doc}`,
    );
  }
});

Deno.test("Each API detail doc exists and is non-trivial", async () => {
  const docs = await Promise.all(
    TOPIC_DOCS.map(async (doc) => {
      const path = `${API_DIR}/${doc}`;
      const content = await Deno.readTextFile(path);
      return { doc, path, content };
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

Deno.test("API_REFERENCE relative links resolve", async () => {
  const content = await Deno.readTextFile(INDEX);
  await assertLinksResolve(content, dirname(INDEX));
});

Deno.test("API detail docs relative links resolve", async () => {
  const docs = await Promise.all(
    TOPIC_DOCS.map(async (doc) => {
      const path = `${API_DIR}/${doc}`;
      const content = await Deno.readTextFile(path);
      return { path, content };
    }),
  );
  await Promise.all(
    docs.map(({ path, content }) => assertLinksResolve(content, dirname(path))),
  );
});

Deno.test("docs/README.md indexes the API reference and the api/ split", async () => {
  const content = await Deno.readTextFile(DOCS_README);
  assert(
    content.includes("API_REFERENCE.md"),
    "docs/README.md must reference API_REFERENCE.md",
  );
  assert(
    content.includes("api/"),
    "docs/README.md must reference the docs/api/ per-surface detail docs",
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
