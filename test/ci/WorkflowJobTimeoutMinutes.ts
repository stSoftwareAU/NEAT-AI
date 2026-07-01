import { assert } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * Verifies that every job in every `.github/workflows/*.y*ml` file declares an
 * explicit `timeout-minutes:` (Issue #2841 — workflow resource-hygiene
 * hardening).
 *
 * A job without `timeout-minutes:` inherits the GitHub default of 360 minutes
 * (6 hours). A wedged step — a hung `deno test`, a stalled network fetch, or a
 * `git push` blocked on a prompt — would therefore hold a runner for up to six
 * hours, burning minutes quota and blocking the queue before GitHub kills it.
 * An explicit per-job timeout caps the blast radius and surfaces genuine
 * slowdowns as fast failures.
 *
 * This is a "what" test: it parses the committed workflow YAML and asserts on
 * the resulting configuration, not on how the value happens to be written.
 */

interface Job {
  "timeout-minutes"?: number;
  "runs-on"?: string;
}

interface Workflow {
  name?: string;
  jobs?: Record<string, Job>;
}

const WORKFLOW_DIR = ".github/workflows";

// The 6-hour GitHub default we are guarding against. Any explicit bound must be
// well below this; a job needing longer almost certainly has a wedged step.
const GITHUB_DEFAULT_TIMEOUT_MINUTES = 360;

async function listWorkflowFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(WORKFLOW_DIR)) {
    if (!entry.isFile) continue;
    if (/\.ya?ml$/.test(entry.name)) {
      files.push(`${WORKFLOW_DIR}/${entry.name}`);
    }
  }
  return files.sort();
}

async function readWorkflow(path: string): Promise<Workflow> {
  const text = await Deno.readTextFile(path);
  return parse(text) as Workflow;
}

Deno.test("at least one workflow file is present to validate", async () => {
  const files = await listWorkflowFiles();
  assert(files.length > 0, `no workflow files found under ${WORKFLOW_DIR}`);
});

Deno.test("every workflow job declares an explicit timeout-minutes", async () => {
  const files = await listWorkflowFiles();
  const workflows = await Promise.all(
    files.map(async (file) => ({ file, wf: await readWorkflow(file) })),
  );
  for (const { file, wf } of workflows) {
    const jobs = wf.jobs ?? {};
    const jobIds = Object.keys(jobs);
    assert(jobIds.length > 0, `${file} declares no jobs`);

    for (const jobId of jobIds) {
      const job = jobs[jobId];
      const timeout = job["timeout-minutes"];
      assert(
        typeof timeout === "number",
        `${file} job "${jobId}" is missing timeout-minutes (inherits the ` +
          `${GITHUB_DEFAULT_TIMEOUT_MINUTES}-minute GitHub default)`,
      );
      assert(
        Number.isInteger(timeout) && timeout > 0,
        `${file} job "${jobId}" timeout-minutes must be a positive integer, ` +
          `got ${timeout}`,
      );
      assert(
        timeout < GITHUB_DEFAULT_TIMEOUT_MINUTES,
        `${file} job "${jobId}" timeout-minutes (${timeout}) must be tighter ` +
          `than the ${GITHUB_DEFAULT_TIMEOUT_MINUTES}-minute GitHub default`,
      );
    }
  }
});

// The coverage run collects test coverage across the whole suite and is the
// heaviest workflow. It has occasionally exceeded the previous 30-minute cap
// and failed PRs (Issue #3168). Its bound is deliberately more generous than
// the other jobs, so assert the floor explicitly to guard against a regression
// back to a too-tight value.
const COVERAGE_WORKFLOW = `${WORKFLOW_DIR}/coverage.yaml`;
const COVERAGE_MIN_TIMEOUT_MINUTES = 60;

Deno.test("coverage workflow allows at least an hour for its job", async () => {
  const wf = await readWorkflow(COVERAGE_WORKFLOW);
  const jobs = wf.jobs ?? {};
  const jobIds = Object.keys(jobs);
  assert(jobIds.length > 0, `${COVERAGE_WORKFLOW} declares no jobs`);

  for (const jobId of jobIds) {
    const timeout = jobs[jobId]["timeout-minutes"];
    assert(
      typeof timeout === "number" && timeout >= COVERAGE_MIN_TIMEOUT_MINUTES,
      `${COVERAGE_WORKFLOW} job "${jobId}" timeout-minutes (${timeout}) must be ` +
        `at least ${COVERAGE_MIN_TIMEOUT_MINUTES} minutes (Issue #3168)`,
    );
  }
});
