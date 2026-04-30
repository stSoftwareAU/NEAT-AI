import { assert } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * Validates the Markdown Lint workflow
 * (`.github/workflows/markdown-lint.yml`) added for Issue #2507.
 *
 * The workflow installs markdownlint-cli2 on a Node LTS runner and lints all
 * Markdown files using the repo's existing `.markdownlint-cli2.jsonc`
 * configuration. These tests parse the workflow YAML and assert on its
 * structural shape so the quality gate cannot silently regress.
 */

const WORKFLOW_PATH = ".github/workflows/markdown-lint.yml";

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  id?: string;
  with?: Record<string, unknown>;
}

interface Workflow {
  name: string;
  // `on` is reserved in YAML 1.1 and parses to boolean true; the parsed key
  // stays the literal string "on".
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, { "runs-on": string; steps: WorkflowStep[] }>;
}

async function readWorkflow(): Promise<Workflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parse(text) as Workflow;
}

Deno.test("markdown-lint workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH).catch(() => null);
  assert(stat?.isFile, `${WORKFLOW_PATH} must exist`);
});

Deno.test("markdown-lint workflow triggers on pull_request and push", async () => {
  const wf = await readWorkflow();
  const triggers = wf.on as Record<string, unknown>;
  assert("pull_request" in triggers, "workflow must trigger on pull_request");
  assert("push" in triggers, "workflow must trigger on push");
});

Deno.test("markdown-lint workflow grants only contents: read", async () => {
  const wf = await readWorkflow();
  assert(wf.permissions, "workflow must declare permissions");
  assert(
    wf.permissions.contents === "read",
    "workflow must grant contents: read (least privilege)",
  );
});

Deno.test("markdown-lint workflow checks out repo and sets up Node", async () => {
  const wf = await readWorkflow();
  const steps = wf.jobs.markdownlint.steps;
  const usesList = steps.map((s) => s.uses ?? "");
  assert(
    usesList.some((u) => u.startsWith("actions/checkout@")),
    "workflow must use actions/checkout",
  );
  assert(
    usesList.some((u) => u.startsWith("actions/setup-node@")),
    "workflow must use actions/setup-node",
  );
});

Deno.test("markdown-lint workflow pins third-party actions to commit SHAs", async () => {
  const wf = await readWorkflow();
  const steps = wf.jobs.markdownlint.steps;
  const sha40 = /@[0-9a-f]{40}$/;
  for (const step of steps) {
    if (step.uses) {
      assert(
        sha40.test(step.uses),
        `step using ${step.uses} must pin to a 40-char commit SHA`,
      );
    }
  }
});

Deno.test("markdown-lint workflow installs and runs markdownlint-cli2", async () => {
  const wf = await readWorkflow();
  const runs = wf.jobs.markdownlint.steps
    .map((s) => s.run ?? "")
    .join("\n");
  assert(
    runs.includes("npm install -g markdownlint-cli2"),
    "workflow must install markdownlint-cli2 globally",
  );
  assert(
    /(^|\n)\s*markdownlint-cli2\s*($|\n)/.test(runs),
    "workflow must invoke markdownlint-cli2",
  );
});

Deno.test("markdown-lint workflow gates the optional Mermaid step on detect-deno", async () => {
  const wf = await readWorkflow();
  const steps = wf.jobs.markdownlint.steps;
  const detect = steps.find((s) => s.id === "detect-deno");
  assert(detect, "workflow must include a detect-deno step");
  const mermaidStep = steps.find((s) =>
    (s.run ?? "").includes("check-mermaid")
  );
  assert(mermaidStep, "workflow must include a check-mermaid step");
  assert(
    (mermaidStep.if ?? "").includes("detect-deno"),
    "check-mermaid step must be gated on detect-deno output",
  );
});

Deno.test(".markdownlint-cli2.jsonc config is present so the workflow has globs", async () => {
  const stat = await Deno.stat(".markdownlint-cli2.jsonc").catch(() => null);
  assert(
    stat?.isFile,
    ".markdownlint-cli2.jsonc must exist to drive markdownlint-cli2 file selection",
  );
});
