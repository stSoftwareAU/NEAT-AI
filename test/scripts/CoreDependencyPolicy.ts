import { assert, assertEquals } from "@std/assert";

/**
 * Tests that the workspace Cargo.toml conforms to the NEAT-AI-core
 * dependency pinning policy defined in docs/CORE_DEPENDENCY_POLICY.md.
 *
 * Issue #2342 — verifies crate name, rev-pinning, and semver tag format.
 */

const WORKSPACE_CARGO = "Cargo.toml";
const MEMBER_CARGO = "wasm_activation/Cargo.toml";
const POLICY_DOC = "docs/CORE_DEPENDENCY_POLICY.md";

Deno.test("workspace Cargo.toml pins neat-core via git with a rev", async () => {
  const content = await Deno.readTextFile(WORKSPACE_CARGO);

  // Must use `neat-core` as the dependency name.
  assert(
    content.includes("neat-core"),
    "workspace Cargo.toml must declare a neat-core dependency",
  );

  // Must pin to a specific commit via `rev = "..."`.
  const revPattern = /neat-core\s*=\s*\{[^}]*rev\s*=/;
  assert(
    revPattern.test(content),
    'neat-core dependency must be pinned with rev = "<sha>"',
  );

  // Must point to the stSoftwareAU/NEAT-AI-core repository.
  assert(
    content.includes("stSoftwareAU/NEAT-AI-core"),
    "neat-core git URL must reference stSoftwareAU/NEAT-AI-core",
  );
});

Deno.test("workspace Cargo.toml rev is a valid 40-char hex SHA", async () => {
  const content = await Deno.readTextFile(WORKSPACE_CARGO);
  const match = content.match(/rev\s*=\s*"([^"]+)"/);
  assert(match, "could not extract rev value from Cargo.toml");

  const rev = match![1];
  assert(
    /^[0-9a-f]{40}$/.test(rev),
    `rev must be a full 40-character hex SHA, got: "${rev}"`,
  );
});

Deno.test("wasm_activation uses workspace dependency for neat-core", async () => {
  const content = await Deno.readTextFile(MEMBER_CARGO);

  // The member crate must inherit neat-core from the workspace,
  // not declare its own git/path dependency.
  assert(
    content.includes("neat-core"),
    "wasm_activation/Cargo.toml must depend on neat-core",
  );

  const workspacePattern = /neat-core\s*=\s*\{\s*workspace\s*=\s*true\s*\}/;
  assert(
    workspacePattern.test(content),
    "wasm_activation must use `neat-core = { workspace = true }` (inherited)",
  );
});

Deno.test("workspace does not use branch pinning for neat-core", async () => {
  const content = await Deno.readTextFile(WORKSPACE_CARGO);

  // Branch pinning tracks a moving target — policy requires rev pinning.
  const branchPattern = /neat-core\s*=\s*\{[^}]*branch\s*=/;
  assert(
    !branchPattern.test(content),
    "neat-core must not use branch pinning; use rev pinning instead",
  );
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
    "crate name",
    "rev",
    "local dev",
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

Deno.test("workspace crate name matches policy (neat-core not neat_ai_core)", async () => {
  const content = await Deno.readTextFile(WORKSPACE_CARGO);

  // The Cargo dependency name is `neat-core` (hyphenated).
  // The crate on NEAT-AI-core publishes as `neat-core`.
  // Verify we do not accidentally use the old root crate name.
  const lines = content.split("\n");
  const depLine = lines.find((l) => l.includes("neat-core"));
  assert(depLine, "must have a neat-core dependency line");

  // Must NOT reference an old name like `neat_ai_core` or `neat-ai-core`.
  assertEquals(
    content.includes("neat_ai_core"),
    false,
    "must use neat-core, not neat_ai_core",
  );
  assertEquals(
    content.includes("neat-ai-core"),
    false,
    "must use neat-core, not neat-ai-core (that is the repo name, not the crate)",
  );
});
