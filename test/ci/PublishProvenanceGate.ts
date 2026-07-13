/**
 * Issue #3334 (parent #3332) — the publish pipeline silently succeeded while
 * producing NO provenance attestation for v5.8.1 (rekorLogId null on JSR). A
 * release that publishes without provenance must fail LOUDLY, not pass quietly.
 *
 * `publish.yml` now runs a post-publish verification step that polls the JSR
 * version meta endpoint and fails the job when rekorLogId is null/absent.
 *
 * These tests parse the committed workflow YAML and assert on the resulting
 * configuration — they guard against the gate itself regressing (step deleted,
 * or its `if:` guard broken so it never runs), which is exactly the failure
 * surface the issue calls out. They are "what" tests over CI config: there is
 * no runtime behaviour to exercise, only the shipped workflow.
 */

import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const PUBLISH_WORKFLOW = join(REPO_ROOT, ".github/workflows/publish.yml");

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
}

interface Job {
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

async function readWorkflow(): Promise<Workflow> {
  const text = await Deno.readTextFile(PUBLISH_WORKFLOW);
  return parse(text) as Workflow;
}

function allSteps(wf: Workflow): Step[] {
  const steps: Step[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) steps.push(step);
  }
  return steps;
}

function provenanceStep(wf: Workflow): Step | undefined {
  return allSteps(wf).find(
    (s) => typeof s.run === "string" && /verify_jsr_provenance\.sh/.test(s.run),
  );
}

Deno.test("publish.yml runs the JSR provenance verification step (Issue #3334)", async () => {
  const wf = await readWorkflow();
  const step = provenanceStep(wf);
  assert(
    step !== undefined,
    "publish.yml must run scripts/verify_jsr_provenance.sh after publishing so " +
      "a release with no Sigstore provenance (rekorLogId null) fails the job",
  );
});

Deno.test("publish.yml only verifies provenance when a publish ran (Issue #3334)", async () => {
  const wf = await readWorkflow();
  const step = provenanceStep(wf);
  assert(step !== undefined, "provenance verification step missing");

  // Every push to Develop runs this workflow, but a publish only happens on a
  // release commit. The check must be gated on the same needs_publish signal
  // that gates the JSR publish step — otherwise it runs (and fails) on pushes
  // where nothing was published.
  const cond = step!.if ?? "";
  assert(
    /needs_publish\.outputs\.publish\s*==\s*'true'/.test(cond),
    "the provenance verification step must be gated on " +
      "steps.needs_publish.outputs.publish == 'true' so it only runs for a " +
      `new release version, got if: '${cond}'`,
  );
});
