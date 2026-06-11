import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * Issue #2904 — the Publish workflow must not attempt to publish unless on the
 * Develop branch, and must not re-attempt publishing a version that is already
 * on JSR.
 *
 * Symptom: every push to Develop triggers the workflow, but the package
 * `version` only changes on a release commit. Running `jsr publish` for a
 * version that already exists on JSR hangs the CLI until the 15-minute job
 * timeout cancels it ("Publish / publish (push) — Cancelled after 15m").
 *
 * Two guards prevent this:
 *  1. The push trigger restricts to Develop AND the job carries an explicit
 *     `if: github.ref == 'refs/heads/Develop'` guard (defence in depth — the
 *     job never runs on any other ref).
 *  2. The publish step is gated on a prior step that checks whether the version
 *     is already published, so a routine Develop push that does not bump the
 *     version never reaches `jsr publish`.
 *
 * These are "what" tests: they parse the committed workflow YAML and assert on
 * the resulting configuration.
 */

interface Step {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
}

interface Job {
  if?: string;
  steps?: Step[];
}

interface PushTrigger {
  branches?: string[];
}

interface Triggers {
  push?: PushTrigger;
  // Any other trigger key (pull_request, workflow_dispatch, …) would let the
  // workflow run off Develop, so we assert the set of trigger keys explicitly.
  [key: string]: unknown;
}

interface Workflow {
  on?: Triggers;
  jobs?: Record<string, Job>;
}

const PUBLISH_WORKFLOW = ".github/workflows/publish.yml";

async function readPublishWorkflow(): Promise<Workflow> {
  const text = await Deno.readTextFile(PUBLISH_WORKFLOW);
  return parse(text) as Workflow;
}

function publishJob(wf: Workflow): Job {
  const jobs = wf.jobs ?? {};
  const job = jobs["publish"];
  assert(job !== undefined, "publish.yml must define a `publish` job");
  return job;
}

Deno.test("publish.yml only triggers on push to Develop", async () => {
  const wf = await readPublishWorkflow();
  // `parse` may key the `on:` block as the boolean `true` because YAML treats a
  // bare `on` as a truthy keyword; tolerate both spellings.
  const triggers = (wf.on ?? (wf as Record<string, unknown>)["true"]) as
    | Triggers
    | undefined;
  assert(triggers !== undefined, "publish.yml must declare an `on:` block");

  const triggerKeys = Object.keys(triggers);
  assertEquals(
    triggerKeys,
    ["push"],
    "publish.yml must only trigger on push (no pull_request/workflow_dispatch " +
      "that could run off the Develop branch)",
  );

  assertEquals(
    triggers.push?.branches,
    ["Develop"],
    "publish.yml push trigger must be restricted to the Develop branch",
  );
});

Deno.test("publish job carries an explicit Develop branch guard", async () => {
  const wf = await readPublishWorkflow();
  const job = publishJob(wf);
  const guard = job.if ?? "";
  assert(
    guard.includes("github.ref"),
    "publish job `if:` must reference github.ref so the job only runs on a " +
      `specific branch; got: ${JSON.stringify(job.if)}`,
  );
  assert(
    guard.includes("refs/heads/Develop"),
    "publish job `if:` must require refs/heads/Develop so publish never runs " +
      `on any other branch (Issue #2904); got: ${JSON.stringify(job.if)}`,
  );
});

Deno.test("publish step is gated on a prior version-published check", async () => {
  const wf = await readPublishWorkflow();
  const job = publishJob(wf);
  const steps = job.steps ?? [];

  const publishStep = steps.find((s) => (s.run ?? "").includes("jsr publish"));
  assert(
    publishStep !== undefined,
    "publish job must contain a step that runs `jsr publish`",
  );

  const condition = publishStep.if ?? "";
  assert(
    condition.length > 0,
    "the `jsr publish` step must carry an `if:` guard so a routine Develop " +
      "push that does not bump the version never re-attempts publishing an " +
      "already-published version (Issue #2904)",
  );

  // The guard must reference the output of an earlier step (steps.<id>.outputs)
  // rather than a constant, so it reflects the live published-version check.
  assert(
    condition.includes("steps.") && condition.includes("outputs."),
    "the `jsr publish` step `if:` must depend on a prior step output " +
      `(steps.<id>.outputs.<name>); got: ${JSON.stringify(publishStep.if)}`,
  );

  // The referenced step must exist and actually query JSR for the version.
  const checkStep = steps.find((s) =>
    (s.run ?? "").includes("jsr.io") && (s.run ?? "").includes("deno.json")
  );
  assert(
    checkStep !== undefined && typeof checkStep.id === "string",
    "publish job must contain an identified step that checks JSR for the " +
      "deno.json version before publishing",
  );
  assert(
    condition.includes(checkStep!.id!),
    "the `jsr publish` step `if:` must reference the version-check step id " +
      `(${checkStep!.id}); got: ${JSON.stringify(publishStep.if)}`,
  );
});
