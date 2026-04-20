import { assert, assertEquals } from "@std/assert";

/**
 * Tests that deno.json conforms to the NEAT-AI-core
 * dependency pinning policy defined in docs/CORE_DEPENDENCY_POLICY.md.
 *
 * Issue #2342 — verifies repo+ref policy and documentation references.
 */

const DENO_JSON = "deno.json";
const POLICY_DOC = "docs/CORE_DEPENDENCY_POLICY.md";

Deno.test("deno.json pins neatCore repo and ref", async () => {
  const json = JSON.parse(await Deno.readTextFile(DENO_JSON));
  const neatCore = json.neatCore;
  assert(neatCore, "deno.json must define neatCore");
  assertEquals(
    neatCore.repo,
    "stSoftwareAU/NEAT-AI-core",
    "neatCore.repo must target stSoftwareAU/NEAT-AI-core",
  );
  assert(
    typeof neatCore.ref === "string" && neatCore.ref.length > 0,
    "neatCore.ref must be a non-empty branch/tag/ref",
  );
  if (typeof neatCore.rev === "string" && neatCore.rev.length > 0) {
    assert(
      /^[0-9a-f]{40}$/.test(neatCore.rev),
      "neatCore.rev must be a full 40-character hex SHA when set",
    );
  }
});

Deno.test("core dependency policy document exists", async () => {
  const info = await Deno.stat(POLICY_DOC);
  assert(info.isFile, `${POLICY_DOC} must exist`);
});

Deno.test("policy document covers required sections", async () => {
  const content = await Deno.readTextFile(POLICY_DOC);
  const lower = content.toLowerCase();

  const requiredTopics = [
    "semver",
    "deno.json",
    "ref",
    "build.sh",
    "approval",
  ];

  for (const topic of requiredTopics) {
    assert(
      lower.includes(topic),
      `policy document must cover "${topic}"`,
    );
  }
});

Deno.test("AGENTS.md references the core dependency policy", async () => {
  const content = await Deno.readTextFile("AGENTS.md");
  assert(
    content.includes("CORE_DEPENDENCY_POLICY"),
    "AGENTS.md must reference docs/CORE_DEPENDENCY_POLICY.md",
  );
});
