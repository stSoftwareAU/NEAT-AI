/**
 * Issue #3008 — SCR-SBOM: the release pipeline published no Software Bill of
 * Materials (SBOM) artefact. `publish.yml` ships `@stsoftware/neat-ai` to JSR
 * on every release commit, so the source-only exemption does not apply: a
 * machine-readable SBOM lets downstream consumers and security teams enumerate
 * exactly which transitive dependencies a published version shipped, without
 * re-resolving the tree.
 *
 * `publish.yml` now generates a CycloneDX SBOM from the committed deno.lock and
 * uploads it as a build artefact whenever a new version is published.
 *
 * These are "what" tests: they parse the committed workflow YAML and assert on
 * the resulting configuration, not on exactly how each value is written.
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
  with?: Record<string, unknown>;
}

interface Job {
  if?: string;
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

async function readWorkflow(): Promise<Workflow> {
  const text = await Deno.readTextFile(PUBLISH_WORKFLOW);
  return parse(text) as Workflow;
}

/** A step paired with the `if:` of the job that contains it. */
interface OwnedStep {
  step: Step;
  jobIf: string;
}

function allSteps(wf: Workflow): OwnedStep[] {
  const steps: OwnedStep[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      steps.push({ step, jobIf: job.if ?? "" });
    }
  }
  return steps;
}

function sbomGenerationStep(wf: Workflow): OwnedStep | undefined {
  return allSteps(wf).find(
    ({ step }) => typeof step.run === "string" && /cdxgen/.test(step.run),
  );
}

function sbomUploadStep(wf: Workflow): OwnedStep | undefined {
  return allSteps(wf).find(
    ({ step }) =>
      typeof step.uses === "string" &&
      /actions\/upload-artifact/.test(step.uses),
  );
}

/**
 * The condition that actually decides whether a step runs: its own `if:` plus
 * the `if:` of its job. Issue #3668 moved the SBOM steps into a dedicated job
 * with no `id-token` grant, so the release gate is now expressed once on the
 * job (`needs.publish.outputs.publish`) instead of on each step
 * (`steps.needs_publish.outputs.publish`). Either placement satisfies the
 * requirement this test encodes — that the SBOM is emitted only for a new
 * release version.
 */
function effectiveCondition({ step, jobIf }: OwnedStep): string {
  return [jobIf, step.if ?? ""].filter((c) => c !== "").join(" && ");
}

Deno.test("publish.yml generates a CycloneDX SBOM from the lockfile (Issue #3008)", async () => {
  const wf = await readWorkflow();
  const step = sbomGenerationStep(wf);
  assert(
    step !== undefined,
    "publish.yml must run a CycloneDX generator (e.g. npm:@cyclonedx/cdxgen) " +
      "to produce an SBOM for the published version",
  );
  const run = step!.step.run ?? "";
  // Deno has no first-class SBOM emitter, so the generator must target Deno so
  // it reads the resolved deno.lock rather than guessing the ecosystem.
  assert(
    /-t\s+deno\b/.test(run),
    "the SBOM generator must target the Deno ecosystem (`-t deno`) so it " +
      "enumerates the resolved deno.lock dependency tree",
  );
});

Deno.test("publish.yml writes a recognisable SBOM filename (Issue #3008)", async () => {
  const wf = await readWorkflow();
  const gen = sbomGenerationStep(wf);
  const upload = sbomUploadStep(wf);
  assert(gen !== undefined, "no SBOM generation step found");
  assert(upload !== undefined, "no SBOM upload step found");

  const genRun = gen!.step.run ?? "";
  // CycloneDX SBOMs are conventionally named *.cdx.json (or sbom*.json).
  assert(
    /(sbom[^\s]*\.(json|xml)|[^\s]*\.cdx\.json)/.test(genRun),
    "the SBOM generation step must write a recognisable SBOM file " +
      "(e.g. sbom.cdx.json) so consumers can find it",
  );

  const path = String(upload!.step.with?.["path"] ?? "");
  assert(
    /(sbom|\.cdx\.json)/.test(path),
    "the upload-artifact step must upload the generated SBOM file via its " +
      `\`path\`, got '${path}'`,
  );
});

Deno.test("publish.yml uploads the SBOM as a build artefact (Issue #3008)", async () => {
  const wf = await readWorkflow();
  const upload = sbomUploadStep(wf);
  assert(
    upload !== undefined,
    "publish.yml must upload the generated SBOM via actions/upload-artifact " +
      "so downstream consumers can retrieve the bill of materials",
  );
  const name = String(upload!.step.with?.["name"] ?? "");
  assert(
    name.trim().length > 0,
    "the upload-artifact step must set a non-empty artefact `name`",
  );
});

Deno.test("publish.yml only emits the SBOM when a new version is published (Issue #3008)", async () => {
  const wf = await readWorkflow();
  const gen = sbomGenerationStep(wf);
  const upload = sbomUploadStep(wf);
  assert(gen !== undefined && upload !== undefined, "SBOM steps missing");

  // Every push to Develop runs this workflow, but the version only changes on a
  // release commit. The SBOM is a per-release artefact, so both steps must be
  // gated on the same needs_publish signal that gates the JSR publish step —
  // either directly on the step, or on the job that contains it.
  for (
    const [label, owned] of [["generation", gen!], ["upload", upload!]] as const
  ) {
    const cond = effectiveCondition(owned);
    assert(
      /(steps\.needs_publish|needs\.publish)\.outputs\.publish\s*==\s*'true'/
        .test(cond),
      `the SBOM ${label} step must be gated on the publish signal ` +
        "(steps.needs_publish.outputs.publish or needs.publish.outputs.publish " +
        `== 'true') so it only runs for a new release version, got: '${cond}'`,
    );
  }
});
