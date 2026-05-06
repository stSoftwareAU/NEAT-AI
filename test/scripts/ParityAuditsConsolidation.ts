import { assert, assertStringIncludes } from "@std/assert";

/**
 * Issue #2570 — verifies the parity-audit doc consolidation.
 *
 * The three small `*_PARITY_AUDIT.md` stubs are merged into a single
 * `docs/PARITY_AUDITS.md`. The originals are kept as short redirect
 * notes so historical PR-summary links still resolve.
 *
 * The consolidated doc must cover all three audits (NEAT-AI-core,
 * rust_scorer, wasm_activation) and link to the cluster overview.
 */

const CONSOLIDATED = "docs/PARITY_AUDITS.md";
const STUBS = [
  "docs/NEAT_AI_CORE_PARITY_AUDIT.md",
  "docs/RUST_SCORER_PARITY_AUDIT.md",
  "docs/WASM_ACTIVATION_PARITY_AUDIT.md",
];
const OVERVIEW = "docs/EXTERNAL_NEAT_AI_CORE.md";

Deno.test("docs/PARITY_AUDITS.md exists and covers each archived audit", async () => {
  const info = await Deno.stat(CONSOLIDATED);
  assert(info.isFile, `${CONSOLIDATED} must exist`);

  const content = await Deno.readTextFile(CONSOLIDATED);
  // The consolidated doc is the single home for the three archived
  // audits; each issue number must remain searchable.
  assertStringIncludes(content, "#2367");
  assertStringIncludes(content, "#2368");
  assertStringIncludes(content, "#2369");
  // Each audit subject area is named.
  assertStringIncludes(content, "NEAT-AI-core");
  assertStringIncludes(content, "rust_scorer");
  assertStringIncludes(content, "wasm_activation");
  // Links forward to the live verification surfaces.
  assertStringIncludes(content, "scripts/parity-gate.sh");
  assertStringIncludes(content, "PARITY_GATE.md");
});

Deno.test("each audit stub redirects to the consolidated doc", async () => {
  const stubChecks = await Promise.all(
    STUBS.map(async (stub) => ({
      stub,
      info: await Deno.stat(stub),
      content: await Deno.readTextFile(stub),
    })),
  );
  for (const { stub, info, content } of stubChecks) {
    assert(info.isFile, `${stub} must remain as a redirect`);
    assertStringIncludes(
      content,
      "PARITY_AUDITS.md",
      `${stub} must point readers at the consolidated doc`,
    );
  }
});

Deno.test("docs/EXTERNAL_NEAT_AI_CORE.md is the cluster overview", async () => {
  const content = await Deno.readTextFile(OVERVIEW);
  // Cluster overview lists every detail doc in the cluster.
  assertStringIncludes(content, "CORE_DEPENDENCY_POLICY.md");
  assertStringIncludes(content, "PARITY_GATE.md");
  assertStringIncludes(content, "CI_EXTERNAL_NEAT_AI_CORE.md");
  assertStringIncludes(content, "PARITY_AUDITS.md");
  // A Mermaid diagram showing core ↔ extension ↔ this repo.
  assertStringIncludes(content, "```mermaid");
});

Deno.test("docs/CI_EXTERNAL_NEAT_AI_CORE.md matches the real workflows", async () => {
  const content = await Deno.readTextFile("docs/CI_EXTERNAL_NEAT_AI_CORE.md");
  // The actual CI command in .github/workflows/quality.yml and
  // publish.yml is `./build.sh --verify-only`; documentation must
  // not contradict the workflow.
  assertStringIncludes(content, "./build.sh --verify-only");
  // The doc points at the actual workflow files for evidence.
  assertStringIncludes(content, ".github/workflows/quality.yml");
  assertStringIncludes(content, ".github/workflows/publish.yml");
});

Deno.test("docs/README.md links the consolidated audit doc", async () => {
  const content = await Deno.readTextFile("docs/README.md");
  assertStringIncludes(
    content,
    "PARITY_AUDITS.md",
    "docs/README.md must list the consolidated parity audits doc",
  );
});
