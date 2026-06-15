/**
 * Issue #2957 — Phase 0 foundation of the documentation audit (#2956).
 *
 * Verifies the two foundation documents the rest of the audit references:
 *
 *   1. `docs/GLOSSARY.md` — the canonical glossary. Every acronym is
 *      expanded with a deeper-reading link; every themed/house term is
 *      explained; the `NEAT-AI ≠ NEAT` rule points back to the canonical
 *      entry in `AGENTS.md` rather than restating it.
 *   2. `docs/DOC_STYLE.md` — the short documentation style guide that
 *      codifies the rules every per-doc audit must apply.
 *   3. `docs/README.md` links to both foundation documents.
 *
 * These are "what" tests: they read the real files and assert on
 * outcomes (terms present, links resolve, a Mermaid diagram exists), not
 * on implementation details such as line counts or heading styles.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const DOCS_INDEX = join(REPO_ROOT, "docs", "README.md");
const GLOSSARY = join(REPO_ROOT, "docs", "GLOSSARY.md");
const DOC_STYLE = join(REPO_ROOT, "docs", "DOC_STYLE.md");

// Acronyms that must be expanded in the glossary. Matched as substrings;
// the expansion may appear as "WebAssembly (WASM)" or the linked phrase.
const ACRONYM_EXPANSIONS: ReadonlyArray<
  { acronym: string; expansion: string }
> = [
  { acronym: "NEAT", expansion: "NeuroEvolution of Augmenting Topologies" },
  { acronym: "MCMC", expansion: "Markov Chain Monte Carlo" },
  { acronym: "WASM", expansion: "WebAssembly" },
  { acronym: "GPU", expansion: "Graphics Processing Unit" },
  { acronym: "RL", expansion: "Reinforcement Learning" },
  { acronym: "FFI", expansion: "Foreign Function Interface" },
  {
    acronym: "CRISPR",
    expansion: "Clustered Regularly Interspaced Short Palindromic Repeats",
  },
];

// Themed / house terms that must be explained in the glossary.
const THEMED_TERMS: ReadonlyArray<string> = [
  "Creature",
  "Intelligent Design",
  "Evolution",
  "Islands",
  "Discovery",
  "CRISPR",
  "Grafting",
];

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

// ---------------------------------------------------------------------------
// docs/GLOSSARY.md — canonical glossary
// ---------------------------------------------------------------------------

Deno.test("docs/GLOSSARY.md exists and is substantive", async () => {
  const content = await Deno.readTextFile(GLOSSARY);
  assert(content.length > 800, "docs/GLOSSARY.md must be substantive");
});

Deno.test("docs/GLOSSARY.md expands every required acronym", async () => {
  const raw = await Deno.readTextFile(GLOSSARY);
  const normalised = raw.replace(/^\s*>\s?/gm, "").replace(/\s+/g, " ");
  for (const { acronym, expansion } of ACRONYM_EXPANSIONS) {
    assert(
      normalised.includes(expansion),
      `docs/GLOSSARY.md must expand "${acronym}" to "${expansion}"`,
    );
  }
});

Deno.test("docs/GLOSSARY.md explains every themed term", async () => {
  const content = await Deno.readTextFile(GLOSSARY);
  for (const term of THEMED_TERMS) {
    assertStringIncludes(
      content,
      term,
      `docs/GLOSSARY.md must explain the themed term "${term}"`,
    );
  }
});

Deno.test("docs/GLOSSARY.md defers the NEAT-vs-NEAT-AI rule to AGENTS.md", async () => {
  const content = await Deno.readTextFile(GLOSSARY);
  assertStringIncludes(
    content,
    "../AGENTS.md#-neat-vs-neat-ai--which-term-to-use",
    "docs/GLOSSARY.md must link to the canonical NEAT-vs-NEAT-AI rule in AGENTS.md",
  );
});

Deno.test("docs/GLOSSARY.md includes at least one Mermaid diagram", async () => {
  const content = await Deno.readTextFile(GLOSSARY);
  assertStringIncludes(
    content,
    "```mermaid",
    "docs/GLOSSARY.md must contain at least one fenced ```mermaid block",
  );
});

Deno.test("docs/GLOSSARY.md internal links resolve", async () => {
  await assertLinksResolve(GLOSSARY);
});

// ---------------------------------------------------------------------------
// docs/DOC_STYLE.md — documentation style guide
// ---------------------------------------------------------------------------

Deno.test("docs/DOC_STYLE.md exists and is substantive", async () => {
  const content = await Deno.readTextFile(DOC_STYLE);
  assert(content.length > 800, "docs/DOC_STYLE.md must be substantive");
});

Deno.test("docs/DOC_STYLE.md captures the core house-style rules", async () => {
  const raw = await Deno.readTextFile(DOC_STYLE);
  const lower = raw.toLowerCase();
  const rules = [
    "acronym", // define every acronym on first use
    "glossary", // link themed terms to the glossary
    "fact-check", // fact-check against implementation + references
    "mermaid", // prefer colour + Mermaid diagrams
  ];
  for (const rule of rules) {
    assert(
      lower.includes(rule),
      `docs/DOC_STYLE.md must mention the "${rule}" rule`,
    );
  }
});

Deno.test("docs/DOC_STYLE.md links to the glossary and the NEAT rule", async () => {
  const content = await Deno.readTextFile(DOC_STYLE);
  assertStringIncludes(
    content,
    "GLOSSARY.md",
    "docs/DOC_STYLE.md must link to the glossary",
  );
  assertStringIncludes(
    content,
    "../AGENTS.md#-neat-vs-neat-ai--which-term-to-use",
    "docs/DOC_STYLE.md must link to the canonical NEAT-vs-NEAT-AI rule",
  );
});

Deno.test("docs/DOC_STYLE.md internal links resolve", async () => {
  await assertLinksResolve(DOC_STYLE);
});

// ---------------------------------------------------------------------------
// docs/README.md — links to the foundation documents
// ---------------------------------------------------------------------------

Deno.test("docs/README.md links to the glossary and style guide", async () => {
  const content = await Deno.readTextFile(DOCS_INDEX);
  assertStringIncludes(
    content,
    "GLOSSARY.md",
    "docs/README.md must link to the canonical glossary",
  );
  assertStringIncludes(
    content,
    "DOC_STYLE.md",
    "docs/README.md must link to the documentation style guide",
  );
});
