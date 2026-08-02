/**
 * Issue #3334 (parent #3332), reworked by Issue #3633 — a release that
 * publishes without Sigstore provenance must fail LOUDLY, not pass quietly.
 *
 * The gate originally polled JSR's `<version>_meta.json` for a non-null
 * `rekorLogId`. JSR stopped populating that field for every package in the
 * registry around 2026-07-02 (upstream jsr-io/jsr#1474), so the gate turned 12+
 * consecutive publish runs red even though `deno publish` was minting genuine
 * transparency-log entries. The gate now verifies the entry against Rekor —
 * the authoritative source — and treats JSR's value as informational.
 *
 * These tests parse the committed workflow YAML and assert on the resulting
 * configuration. They guard the two ways the gate can regress: it stops running
 * at all (step deleted, or its `if:` guard broken), or it goes back to gating
 * on JSR's dead `rekorLogId` surface. Sibling coverage of *how* the publish
 * itself runs lives in `ProvenancePublishWorkflow.ts`.
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
    (s) => typeof s.run === "string" && /verify_provenance\.ts/.test(s.run),
  );
}

Deno.test("publish.yml runs the provenance verification gate (Issue #3334)", async () => {
  const wf = await readWorkflow();
  const step = provenanceStep(wf);
  assert(
    step !== undefined,
    "publish.yml must run scripts/verify_provenance.ts after publishing so a " +
      "release with no Sigstore provenance fails the job",
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

Deno.test("the gate verifies the attestation against Rekor (Issue #3633)", async () => {
  const wf = await readWorkflow();
  const step = provenanceStep(wf);
  assert(step !== undefined, "provenance verification step missing");
  const run = step!.run ?? "";

  // Rekor is the authoritative transparency log; JSR's rekorLogId has been null
  // registry-wide since 2026-07-02 (jsr-io/jsr#1474) and cannot gate a release.
  assert(
    /rekor\.sigstore\.dev/.test(run),
    "the gate must be granted network access to Rekor so it can confirm the " +
      `transparency-log entry directly, got run: ${JSON.stringify(run)}`,
  );

  // It must consume the transcript the publish step captured — that is where
  // the minted logIndex comes from.
  assert(
    /publish-output\.log/.test(run),
    "the gate must read the captured `deno publish` output to recover the " +
      `Sigstore logIndex, got run: ${JSON.stringify(run)}`,
  );
});

Deno.test("no publish step gates the release on JSR's dead rekorLogId (Issue #3633)", async () => {
  const wf = await readWorkflow();
  const shellGate = allSteps(wf).find(
    (s) => /verify_jsr_provenance\.sh/.test(s.run ?? ""),
  );
  assert(
    shellGate === undefined,
    "the JSR rekorLogId gate must not be reinstated: JSR returns null for " +
      "every package in the registry (jsr-io/jsr#1474), so it fails every " +
      "publish regardless of whether provenance was actually minted",
  );
});
