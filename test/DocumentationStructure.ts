/**
 * TDD tests for documentation structure and DRY compliance.
 *
 * These tests verify that:
 * - AGENTS.md exists and contains coding guidelines
 * - README.md is human-readable and delegates coding info to AGENTS.md
 * - Terminology is defined once (in AGENTS.md) and referenced elsewhere
 * - No significant content duplication across documentation files
 *
 * Issue #1274: Clean up after large changes
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";

/** Read a file and return its content, or empty string if missing. */
async function readFile(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return "";
  }
}

/** Count occurrences of a heading in markdown content. */
function countHeading(content: string, heading: string): number {
  const pattern = new RegExp(`^#+\\s+${heading}`, "gm");
  const matches = content.match(pattern);
  return matches ? matches.length : 0;
}

Deno.test("DocumentationStructure: AGENTS.md exists", async () => {
  const content = await readFile("AGENTS.md");
  assertNotEquals(content, "", "AGENTS.md should exist and not be empty");
});

Deno.test("DocumentationStructure: AGENTS.md contains coding guidelines", async () => {
  const content = await readFile("AGENTS.md");

  // Should contain key coding guidance sections
  assert(
    content.includes("Terminology"),
    "AGENTS.md should contain Terminology section",
  );
  assert(
    content.includes("Coding Conventions"),
    "AGENTS.md should contain Coding Conventions section",
  );
  assert(
    content.includes("Australian English"),
    "AGENTS.md should mention Australian English spelling",
  );
  assert(
    content.includes("quality.sh"),
    "AGENTS.md should reference quality.sh",
  );
});

Deno.test("DocumentationStructure: AGENTS.md contains project architecture info", async () => {
  const content = await readFile("AGENTS.md");

  assert(
    content.includes("WASM"),
    "AGENTS.md should mention WASM activation",
  );
  assert(
    content.includes("Rust"),
    "AGENTS.md should mention Rust discovery module",
  );
  assert(
    content.includes("TypeScript"),
    "AGENTS.md should mention TypeScript",
  );
});

Deno.test("DocumentationStructure: Terminology defined once in AGENTS.md", async () => {
  const agents = await readFile("AGENTS.md");
  const readme = await readFile("README.md");
  const comparison = await readFile("COMPARISON.md");

  // AGENTS.md should have the terminology section
  const agentsTermCount = countHeading(agents, "Terminology");
  assertEquals(
    agentsTermCount,
    1,
    "AGENTS.md should have exactly one Terminology section",
  );

  // README.md should reference AGENTS.md for terminology, not duplicate it
  const readmeTermCount = countHeading(readme, "Terminology");
  assertEquals(
    readmeTermCount,
    0,
    "README.md should not have its own Terminology section (should reference AGENTS.md)",
  );

  // COMPARISON.md should reference AGENTS.md for terminology, not duplicate it
  const comparisonTermCount = countHeading(
    comparison,
    "Terminology Cheat Sheet",
  );
  assertEquals(
    comparisonTermCount,
    0,
    "COMPARISON.md should not have Terminology Cheat Sheet (should reference AGENTS.md)",
  );
});

Deno.test("DocumentationStructure: README.md references AGENTS.md", async () => {
  const readme = await readFile("README.md");

  assert(
    readme.includes("AGENTS.md"),
    "README.md should reference AGENTS.md",
  );
});

Deno.test("DocumentationStructure: COMPARISON.md references AGENTS.md for terminology", async () => {
  const comparison = await readFile("COMPARISON.md");

  assert(
    comparison.includes("AGENTS.md"),
    "COMPARISON.md should reference AGENTS.md for terminology",
  );
});

Deno.test("DocumentationStructure: README.md does not duplicate Discovery details", async () => {
  const readme = await readFile("README.md");

  // README should not have extensive Discovery cache/replay documentation
  // (that belongs in docs/DISCOVERY_GUIDE.md)
  assert(
    !readme.includes("Discovery Failure Cache"),
    "README.md should not contain Discovery Failure Cache section (belongs in DISCOVERY_GUIDE.md)",
  );
  assert(
    !readme.includes("Discovery Success Cache"),
    "README.md should not contain Discovery Success Cache section (belongs in DISCOVERY_GUIDE.md)",
  );
  assert(
    !readme.includes("Discovery Candidate Category Limits"),
    "README.md should not contain Discovery Candidate Category Limits section (belongs in DISCOVERY_GUIDE.md)",
  );
  assert(
    !readme.includes("Forced Focus Overrides"),
    "README.md should not contain Forced Focus Overrides section (belongs in docs/)",
  );
  assert(
    !readme.includes("Discovery Cost-of-Growth Gate"),
    "README.md should not duplicate Discovery Cost-of-Growth Gate (belongs in docs/)",
  );
});

Deno.test("DocumentationStructure: README.md remains useful for humans", async () => {
  const readme = await readFile("README.md");

  // README should still contain essential human-readable sections
  assert(
    readme.includes("Feature Highlights"),
    "README.md should have Feature Highlights",
  );
  assert(
    readme.includes("Usage"),
    "README.md should have Usage section",
  );
  assert(
    readme.includes("License"),
    "README.md should have License section",
  );
  assert(
    readme.includes("Documentation"),
    "README.md should have Documentation section linking to docs/",
  );
});

Deno.test("DocumentationStructure: AGENTS.md contains deployment checklist", async () => {
  const agents = await readFile("AGENTS.md");
  const readme = await readFile("README.md");

  // Deployment checklist should be in AGENTS.md (coding/dev info)
  assert(
    agents.includes("quality.sh"),
    "AGENTS.md should contain quality.sh reference for developers",
  );

  // README should not duplicate the full deployment checklist
  assert(
    !readme.includes("Deployment Checklist"),
    "README.md should not contain Deployment Checklist (belongs in AGENTS.md)",
  );
});

Deno.test("DocumentationStructure: AGENTS.md documents file structure", async () => {
  const agents = await readFile("AGENTS.md");

  assert(
    agents.includes("src/"),
    "AGENTS.md should document source directory structure",
  );
  assert(
    agents.includes("test/"),
    "AGENTS.md should document test directory structure",
  );
});
