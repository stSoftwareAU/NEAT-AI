import { assert } from "@std/assert";

/**
 * Validates the Deno Dependency Updates workflow
 * (`.github/workflows/deno-outdated.yml`) added for Issue #2362.
 *
 * The workflow runs `deno outdated --update --latest` on a weekly cron and
 * raises a pull request via `peter-evans/create-pull-request`. These tests
 * verify the workflow exists and is configured with the required triggers,
 * permissions, and steps so the dependency-update gate cannot silently
 * regress.
 */

const WORKFLOW_PATH = ".github/workflows/deno-outdated.yml";

async function readWorkflow(): Promise<string> {
  return await Deno.readTextFile(WORKFLOW_PATH);
}

Deno.test("deno-outdated workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH).catch(() => null);
  assert(stat?.isFile, `${WORKFLOW_PATH} must exist`);
});

Deno.test("deno-outdated workflow runs on schedule and supports manual dispatch", async () => {
  const body = await readWorkflow();
  assert(
    body.includes("schedule:") && /-\s*cron:\s*"/.test(body),
    "workflow must trigger on a schedule",
  );
  assert(
    body.includes("workflow_dispatch"),
    "workflow must support manual dispatch",
  );
});

Deno.test("deno-outdated workflow has write permissions for contents and pull-requests", async () => {
  const body = await readWorkflow();
  assert(
    /contents:\s*write/.test(body),
    "workflow must grant contents: write",
  );
  assert(
    /pull-requests:\s*write/.test(body),
    "workflow must grant pull-requests: write",
  );
});

Deno.test("deno-outdated workflow checks out repo and sets up Deno", async () => {
  const body = await readWorkflow();
  assert(
    body.includes("actions/checkout@"),
    "workflow must use actions/checkout",
  );
  assert(
    body.includes("denoland/setup-deno@"),
    "workflow must set up Deno via denoland/setup-deno",
  );
});

Deno.test("deno-outdated workflow runs `deno outdated --update --latest`", async () => {
  const body = await readWorkflow();
  assert(
    body.includes("deno outdated --update --latest"),
    "workflow must run `deno outdated --update --latest`",
  );
});

Deno.test("deno-outdated workflow opens a pull request via peter-evans/create-pull-request", async () => {
  const body = await readWorkflow();
  assert(
    body.includes("peter-evans/create-pull-request@"),
    "workflow must use peter-evans/create-pull-request to raise the PR",
  );
  assert(
    body.includes("chore/deno-outdated"),
    "workflow must target the chore/deno-outdated branch",
  );
});
