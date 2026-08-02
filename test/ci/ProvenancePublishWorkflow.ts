/**
 * Issue #3333 — the release pipeline must (a) publish with the job's installed
 * Deno so JSR records a Sigstore provenance attestation, and (b) verify that
 * attestation on the same run so a regression fails loud instead of silently.
 *
 * Background: `@stsoftware/neat-ai` v5.8.0/v5.8.1 published with OIDC granted
 * but `rekorLogId: null`. The old step ran `npx jsr publish`, whose npm shim
 * downloads its own pinned Deno and bypasses the job's `setup-deno` v2.x,
 * silently losing provenance. Publishing with `deno publish` directly restores
 * it (provenance is default-on for `deno publish` on GitHub Actions).
 *
 * Issue #3633 added the transcript capture: `deno publish` prints the Sigstore
 * transparency-log entry it mints, and that printed logIndex is the only place
 * the entry is exposed at publish time, so the output must be captured for the
 * gate (`PublishProvenanceGate.ts`) to verify it against Rekor.
 *
 * These are "what" tests: they parse the committed workflow YAML and assert on
 * the resulting configuration, not on the exact wording of each step.
 */

import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const PUBLISH_WORKFLOW = join(REPO_ROOT, ".github/workflows/publish.yml");

interface Step {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
}
interface Job {
  permissions?: Record<string, string>;
  steps?: Step[];
}
interface Workflow {
  jobs?: Record<string, Job>;
}

async function readWorkflow(): Promise<Workflow> {
  return parse(await Deno.readTextFile(PUBLISH_WORKFLOW)) as Workflow;
}

function steps(wf: Workflow): Step[] {
  const out: Step[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const s of job.steps ?? []) out.push(s);
  }
  return out;
}

Deno.test("publish.yml publishes with `deno publish`, not the npm shim (Issue #3333)", async () => {
  const wf = await readWorkflow();
  const all = steps(wf);

  const publishStep = all.find((s) => /\bdeno\s+publish\b/.test(s.run ?? ""));
  assert(
    publishStep !== undefined,
    "publish job must publish via `deno publish` so the job's installed " +
      "Deno (setup-deno v2.x) attaches Sigstore provenance on GitHub Actions",
  );

  // The npm shim (`npx jsr publish`) downloads its own pinned Deno and bypasses
  // setup-deno, which silently dropped provenance for v5.8.0/v5.8.1.
  const shimStep = all.find((s) => /npx\s+jsr\s+publish/.test(s.run ?? ""));
  assert(
    shimStep === undefined,
    "publish job must NOT use `npx jsr publish` — its npm shim bypasses the " +
      "job's Deno and silently dropped JSR provenance (Issue #3333)",
  );

  // Provenance must not be explicitly disabled.
  assert(
    !/--no-provenance/.test(publishStep!.run ?? ""),
    "the publish step must not pass --no-provenance",
  );
});

Deno.test("publish.yml captures the publish transcript for the gate (Issue #3633)", async () => {
  const wf = await readWorkflow();
  const publishStep = steps(wf).find((s) =>
    /\bdeno\s+publish\b/.test(s.run ?? "")
  );
  assert(publishStep !== undefined, "publish step missing");
  const run = publishStep!.run ?? "";

  // The Sigstore logIndex `deno publish` mints is only ever printed to its own
  // output, so the transcript must be captured for the gate to verify it.
  assert(
    /publish-output\.log/.test(run),
    "the publish step must capture `deno publish` output to " +
      `publish-output.log, got: ${JSON.stringify(run)}`,
  );

  // `tee` without pipefail would swallow a failing `deno publish` behind tee's
  // exit 0 — a silent failure (Issue #3234).
  assert(
    /pipefail/.test(run),
    "the publish step must set `pipefail` so a failing `deno publish` is not " +
      `masked by the \`tee\` pipeline, got: ${JSON.stringify(run)}`,
  );
});

Deno.test("publish job keeps least-privilege OIDC permissions (Issue #3333)", async () => {
  const wf = await readWorkflow();
  const job = (wf.jobs ?? {})["publish"];
  assert(job !== undefined, "publish.yml must define a `publish` job");
  const perms = job.permissions ?? {};
  assert(
    perms["id-token"] === "write",
    "publish job must keep `id-token: write` (OIDC for JSR provenance)",
  );
  assert(
    perms["contents"] === "read",
    "publish job must keep `contents: read` (least privilege)",
  );
});
