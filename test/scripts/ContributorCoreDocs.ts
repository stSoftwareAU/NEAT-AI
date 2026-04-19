import { assert } from "@std/assert";

/**
 * Verifies that contributor-facing documentation explains how to work with the
 * external NEAT-AI-core dependency: bumping the pinned revision, using local
 * path overrides, and cross-linking related repositories.
 *
 * Issue #2347 (part of epic #2341).
 */

const CONTRIBUTING = "CONTRIBUTING.md";
const README = "README.md";

Deno.test("CONTRIBUTING.md covers NEAT-AI-core version bumping", async () => {
  const content = await Deno.readTextFile(CONTRIBUTING);
  const lower = content.toLowerCase();

  assert(
    lower.includes("neat-ai-core") || lower.includes("neat-core"),
    "CONTRIBUTING.md must mention NEAT-AI-core or neat-core dependency",
  );

  assert(
    lower.includes("bump") || lower.includes("update the rev"),
    "CONTRIBUTING.md must explain how to bump the core dependency",
  );

  assert(
    lower.includes("cargo update"),
    "CONTRIBUTING.md must mention `cargo update` for refreshing the lockfile",
  );
});

Deno.test("CONTRIBUTING.md covers local development overrides", async () => {
  const content = await Deno.readTextFile(CONTRIBUTING);
  const lower = content.toLowerCase();

  assert(
    lower.includes(".cargo/config.toml") || lower.includes("path override"),
    "CONTRIBUTING.md must explain local path overrides via .cargo/config.toml",
  );

  assert(
    lower.includes("do not commit") || lower.includes("git-ignored") ||
      lower.includes("gitignore"),
    "CONTRIBUTING.md must warn not to commit .cargo/config.toml",
  );
});

Deno.test("CONTRIBUTING.md cross-links core dependency policy", async () => {
  const content = await Deno.readTextFile(CONTRIBUTING);

  assert(
    content.includes("CORE_DEPENDENCY_POLICY"),
    "CONTRIBUTING.md must link to docs/CORE_DEPENDENCY_POLICY.md",
  );
});

Deno.test("CONTRIBUTING.md cross-links NEAT-AI-core repository", async () => {
  const content = await Deno.readTextFile(CONTRIBUTING);

  assert(
    content.includes("stSoftwareAU/NEAT-AI-core"),
    "CONTRIBUTING.md must link to the NEAT-AI-core repository",
  );
});

Deno.test("README.md references core dependency documentation", async () => {
  const content = await Deno.readTextFile(README);

  assert(
    content.includes("CORE_DEPENDENCY_POLICY") ||
      content.includes("EXTERNAL_NEAT_AI_CORE"),
    "README.md must reference core dependency documentation",
  );
});

Deno.test("CONTRIBUTING.md mentions parity gate", async () => {
  const content = await Deno.readTextFile(CONTRIBUTING);
  const lower = content.toLowerCase();

  assert(
    lower.includes("parity") || lower.includes("parity-gate"),
    "CONTRIBUTING.md must mention the parity gate for core dependency changes",
  );
});
