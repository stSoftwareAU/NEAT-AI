import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * Verifies that the coverage.yaml, quality.yml, and spellcheck.yaml workflows
 * declare a top-level `permissions:` block granting only the minimum scopes
 * they need (Issue #2706 — least-privilege workflow hardening).
 *
 * Without a top-level `permissions:` block, the default GITHUB_TOKEN inherits
 * whatever the repository's default permissions are, which means a drift in
 * repository settings could silently grant write access to these workflows.
 */

interface Workflow {
  name?: string;
  permissions?: Record<string, string> | string;
  jobs: Record<string, unknown>;
}

async function readWorkflow(path: string): Promise<Workflow> {
  const text = await Deno.readTextFile(path);
  return parse(text) as Workflow;
}

Deno.test("coverage.yaml declares a top-level permissions block", async () => {
  const wf = await readWorkflow(".github/workflows/coverage.yaml");
  assert(wf.permissions, "coverage.yaml must declare top-level permissions");
});

Deno.test("coverage.yaml grants only the scopes it needs", async () => {
  const wf = await readWorkflow(".github/workflows/coverage.yaml");
  const perms = wf.permissions as Record<string, string>;
  // Coverage workflow uploads artifacts, posts check-run annotations via
  // EnricoMi/publish-unit-test-result-action, and uploads to Codecov.
  assertEquals(
    perms.contents,
    "read",
    "coverage.yaml must grant contents: read",
  );
  assertEquals(
    perms.checks,
    "write",
    "coverage.yaml must grant checks: write for check-run annotations",
  );
  assertEquals(
    perms["pull-requests"],
    "write",
    "coverage.yaml must grant pull-requests: write for PR annotations",
  );
});

Deno.test("quality.yml declares a top-level permissions block", async () => {
  const wf = await readWorkflow(".github/workflows/quality.yml");
  assert(wf.permissions, "quality.yml must declare top-level permissions");
});

Deno.test("quality.yml grants only contents: read for GITHUB_TOKEN", async () => {
  const wf = await readWorkflow(".github/workflows/quality.yml");
  const perms = wf.permissions as Record<string, string>;
  // quality.yml pushes back to the PR branch but uses secrets.ACTIONS_PUSH
  // (a PAT), not the default GITHUB_TOKEN, so the default token can be
  // downgraded to contents: read.
  assertEquals(
    perms.contents,
    "read",
    "quality.yml must grant contents: read (push uses ACTIONS_PUSH PAT)",
  );
  const keys = Object.keys(perms);
  assertEquals(
    keys.length,
    1,
    `quality.yml must grant only contents: read, got ${keys.join(", ")}`,
  );
});

Deno.test("spellcheck.yaml declares a top-level permissions block", async () => {
  const wf = await readWorkflow(".github/workflows/spellcheck.yaml");
  assert(wf.permissions, "spellcheck.yaml must declare top-level permissions");
});

Deno.test("spellcheck.yaml grants only contents: read (read-only)", async () => {
  const wf = await readWorkflow(".github/workflows/spellcheck.yaml");
  const perms = wf.permissions as Record<string, string>;
  assertEquals(
    perms.contents,
    "read",
    "spellcheck.yaml must grant contents: read",
  );
  const keys = Object.keys(perms);
  assertEquals(
    keys.length,
    1,
    `spellcheck.yaml must grant only contents: read, got ${keys.join(", ")}`,
  );
});
