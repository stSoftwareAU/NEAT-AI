/**
 * Issue #2566 — verifies the docs navigation foundation:
 *
 *   1. `docs/README.md` exists and indexes every major topic doc.
 *   2. `README.md` carries a "Docs map" section linking to that index and
 *      to each major topic doc.
 *   3. `README.md` expands the project's acronyms on first use and contains
 *      at least one Mermaid diagram.
 *
 * These are "what" tests: they read the actual files and assert on
 * outcomes (links resolve, sections exist), not on implementation
 * details such as line counts or heading styles.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const README = join(REPO_ROOT, "README.md");
const DOCS_INDEX = join(REPO_ROOT, "docs", "README.md");

// Topic docs that must appear in docs/README.md. The list is grouped to
// match the index headings so reviewers can see the coverage at a glance.
const TOPIC_DOCS: ReadonlyArray<string> = [
  // Compute / WASM
  "docs/ACTIVATION_FUNCTIONS.md",
  "docs/BACKPROP_ELASTICITY.md",
  "docs/GPU_ACCELERATION.md",
  "docs/WASM_RESIDENT_TOPOLOGY.md",
  // Discovery / FFI
  "docs/DISCOVERY_GUIDE.md",
  "docs/DISCOVERY_DIR.md",
  "docs/DISCOVERY_ARCHITECTURE.md",
  // Performance
  "docs/PERFORMANCE_TUNING.md",
  "docs/PERFORMANCE_RESEARCH.md",
  "docs/PREDICTIVE_CODING_BENCHMARKS.md",
  // Reference
  "docs/API_REFERENCE.md",
  "docs/CONFIGURATION_GUIDE.md",
  "docs/TROUBLESHOOTING.md",
  // Specialised
  "docs/CRISPR_GUIDE.md",
  "docs/INTELLIGENT_DESIGN.md",
  "docs/PREDICTIVE_CODING.md",
  // Governance / core dependency
  "AGENTS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "docs/CORE_DEPENDENCY_POLICY.md",
  "docs/EXTERNAL_NEAT_AI_CORE.md",
  "docs/PARITY_GATE.md",
];

// Acronyms the issue requires to be expanded on first use in README.md.
// Each entry is matched as a substring; expansion may appear inline
// ("WebAssembly (WASM)") or as the linked phrase the acronym stands for.
const ACRONYM_EXPANSIONS: ReadonlyArray<
  { acronym: string; expansion: string }
> = [
  { acronym: "NEAT", expansion: "NeuroEvolution of Augmenting Topologies" },
  { acronym: "WASM", expansion: "WebAssembly" },
  { acronym: "FFI", expansion: "Foreign Function Interface" },
  { acronym: "MCMC", expansion: "Markov Chain Monte Carlo" },
  {
    acronym: "CRISPR",
    expansion: "Clustered Regularly Interspaced Short Palindromic Repeats",
  },
  { acronym: "GPU", expansion: "graphics processing unit" },
  { acronym: "JSR", expansion: "JavaScript Registry" },
];

// ---------------------------------------------------------------------------
// docs/README.md — topic index
// ---------------------------------------------------------------------------

Deno.test("docs/README.md exists and is non-trivial", async () => {
  const content = await Deno.readTextFile(DOCS_INDEX);
  assert(
    content.length > 500,
    "docs/README.md must be substantive (>500 chars)",
  );
});

Deno.test("docs/README.md uses the expected topic groupings", async () => {
  const content = await Deno.readTextFile(DOCS_INDEX);
  const expectedGroups = [
    "Compute",
    "Discovery",
    "Performance",
    "Reference",
    "Specialised",
    "Governance",
  ];
  for (const group of expectedGroups) {
    assertStringIncludes(
      content,
      group,
      `docs/README.md must include a "${group}" topic heading`,
    );
  }
});

Deno.test("docs/README.md links to every major topic doc", async () => {
  const content = await Deno.readTextFile(DOCS_INDEX);
  for (const doc of TOPIC_DOCS) {
    // `docs/README.md` lives inside docs/, so links to sibling docs are
    // relative (e.g. "API_REFERENCE.md") and links to root files are
    // parent-relative (e.g. "../AGENTS.md"). Accept either form.
    const sibling = doc.startsWith("docs/") ? doc.slice("docs/".length) : doc;
    const parent = doc.startsWith("docs/") ? doc : `../${doc}`;
    const present = content.includes(sibling) || content.includes(parent) ||
      content.includes(doc);
    assert(present, `docs/README.md must reference ${doc}`);
  }
});

Deno.test("docs/README.md flags pr-summary-*.md as out of scope", async () => {
  const content = await Deno.readTextFile(DOCS_INDEX);
  assertStringIncludes(
    content,
    "pr-summary-",
    "docs/README.md must mention pr-summary-*.md as out of scope",
  );
  assertStringIncludes(
    content,
    "archive",
    "docs/README.md must mention archive/ as out of scope",
  );
});

Deno.test("docs/README.md provides a 'where to start' reading path", async () => {
  const content = await Deno.readTextFile(DOCS_INDEX);
  const lower = content.toLowerCase();
  assert(
    lower.includes("where to start") || lower.includes("reading path") ||
      lower.includes("getting started"),
    "docs/README.md must include a reading-path/where-to-start section",
  );
});

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

// ---------------------------------------------------------------------------
// README.md — docs map, Mermaid diagram, acronym expansions
// ---------------------------------------------------------------------------

Deno.test("README.md has a Docs map section linking to docs/README.md", async () => {
  const content = await Deno.readTextFile(README);
  assertStringIncludes(
    content,
    "Docs map",
    "README.md must include a 'Docs map' heading",
  );
  assert(
    content.includes("docs/README.md") || content.includes("./docs/README.md"),
    "README.md Docs map must link to docs/README.md",
  );
});

Deno.test("README.md includes at least one Mermaid diagram", async () => {
  const content = await Deno.readTextFile(README);
  assertStringIncludes(
    content,
    "```mermaid",
    "README.md must contain at least one fenced ```mermaid block",
  );
});

Deno.test("README.md expands acronyms on first use", async () => {
  const raw = await Deno.readTextFile(README);
  // Markdown reflow (e.g. `deno fmt`) can split a phrase across lines or
  // insert blockquote prefixes ("> "). Strip blockquote markers first, then
  // collapse all runs of whitespace so the substring check is reflow-
  // resistant.
  const normalised = raw.replace(/^\s*>\s?/gm, "").replace(/\s+/g, " ");
  for (const { acronym, expansion } of ACRONYM_EXPANSIONS) {
    assert(
      normalised.includes(expansion),
      `README.md must expand "${acronym}" to "${expansion}" on first use`,
    );
  }
});

Deno.test("README.md still references core dependency documentation", async () => {
  // Regression guard for the existing ContributorCoreDocs.ts expectation —
  // make sure the docs-map refresh does not drop the core-dep references.
  const content = await Deno.readTextFile(README);
  assert(
    content.includes("CORE_DEPENDENCY_POLICY") ||
      content.includes("EXTERNAL_NEAT_AI_CORE"),
    "README.md must continue to reference core dependency documentation",
  );
});
