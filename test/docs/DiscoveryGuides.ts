/**
 * Issue #2964 — Phase 2 documentation audit of the Discovery subsystem guides.
 *
 * Verifies the three Discovery guides are accurate, non-overlapping, and
 * cross-linked:
 *
 *   1. All three docs exist, are substantive, and carry a Mermaid diagram.
 *   2. Each doc cross-links to the other two and to the canonical glossary.
 *   3. "Discovery" (the themed term) is glossed and the NEAT-AI-vs-standard-
 *      NEAT distinction is explicit, deferring to the canonical rule in
 *      AGENTS.md.
 *   4. On-disk layout lives in DISCOVERY_DIR.md (the division of labour): the
 *      architecture doc defers to it rather than repeating the directory tree.
 *   5. DISCOVERY_DIR.md names the real config option (`discoveryBaseDirectory`)
 *      and no longer references the non-existent `discoveryWorkDir`.
 *   6. All relative links in the three docs resolve on disk.
 *   7. docs/README.md still indexes all three docs.
 *
 * These are "what" tests: they read the actual files and assert on outcomes
 * (links resolve, sections exist), not on implementation details such as
 * exact wording or line counts.
 */

import { assert } from "@std/assert";
import { dirname, fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const DOCS_DIR = `${REPO_ROOT}/docs`;
const DOCS_README = `${DOCS_DIR}/README.md`;

const ARCH = "DISCOVERY_ARCHITECTURE.md";
const GUIDE = "DISCOVERY_GUIDE.md";
const DIR = "DISCOVERY_DIR.md";
const DISCOVERY_DOCS: ReadonlyArray<string> = [ARCH, GUIDE, DIR];

async function readDoc(name: string): Promise<string> {
  return await Deno.readTextFile(`${DOCS_DIR}/${name}`);
}

Deno.test("Discovery docs exist, are substantive, and carry a Mermaid diagram", async () => {
  const docs = await Promise.all(
    DISCOVERY_DOCS.map(async (name) => ({
      name,
      content: await readDoc(name),
    })),
  );
  for (const { name, content } of docs) {
    assert(
      content.length > 1000,
      `${name} must be substantive (>1000 chars), got ${content.length}`,
    );
    assert(
      /^#\s/m.test(content),
      `${name} must contain at least one Markdown heading`,
    );
    assert(
      content.includes("```mermaid"),
      `${name} must contain at least one fenced \`\`\`mermaid block`,
    );
  }
});

Deno.test("Each Discovery doc cross-links to its siblings and the glossary", async () => {
  const docs = await Promise.all(
    DISCOVERY_DOCS.map(async (name) => ({
      name,
      content: await readDoc(name),
    })),
  );
  for (const { name, content } of docs) {
    for (const sibling of DISCOVERY_DOCS) {
      if (sibling === name) continue;
      assert(
        content.includes(sibling),
        `${name} must cross-link to ${sibling}`,
      );
    }
    assert(
      content.includes("GLOSSARY.md"),
      `${name} must link to the canonical glossary (GLOSSARY.md)`,
    );
  }
});

Deno.test("DISCOVERY_GUIDE makes the NEAT-AI-vs-standard-NEAT distinction explicit", async () => {
  const content = await readDoc(GUIDE);
  assert(
    content.includes("standard NEAT"),
    "DISCOVERY_GUIDE.md must contrast Discovery with standard NEAT",
  );
  assert(
    content.includes("-neat-vs-neat-ai--which-term-to-use"),
    "DISCOVERY_GUIDE.md must link to the canonical NEAT-vs-NEAT-AI rule in AGENTS.md",
  );
});

Deno.test("On-disk cache layout lives in DISCOVERY_DIR, not duplicated in the architecture doc", async () => {
  const arch = await readDoc(ARCH);
  // The architecture doc must defer the on-disk tree to DISCOVERY_DIR rather
  // than repeating the changeType directory listing.
  assert(
    arch.includes(DIR),
    "DISCOVERY_ARCHITECTURE.md must link to DISCOVERY_DIR.md for the on-disk layout",
  );
  const dir = await readDoc(DIR);
  assert(
    dir.includes(".discovery/"),
    "DISCOVERY_DIR.md must document the on-disk .discovery/ layout",
  );
});

Deno.test("DISCOVERY_DIR names the real config option and drops the stale one", async () => {
  const content = await readDoc(DIR);
  assert(
    content.includes("discoveryBaseDirectory"),
    "DISCOVERY_DIR.md must reference the real option discoveryBaseDirectory",
  );
  assert(
    !content.includes("discoveryWorkDir"),
    "DISCOVERY_DIR.md must not reference the non-existent discoveryWorkDir option",
  );
});

Deno.test("Discovery docs relative links resolve", async () => {
  await Promise.all(
    DISCOVERY_DOCS.map(async (name) => {
      const path = `${DOCS_DIR}/${name}`;
      const content = await Deno.readTextFile(path);
      await assertLinksResolve(content, dirname(path));
    }),
  );
});

Deno.test("docs/README.md still indexes all three Discovery docs", async () => {
  const content = await Deno.readTextFile(DOCS_README);
  for (const name of DISCOVERY_DOCS) {
    assert(
      content.includes(name),
      `docs/README.md must continue to index ${name}`,
    );
  }
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
