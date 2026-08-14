/**
 * Issue #3668 — the CycloneDX SBOM generator was an unpinned third-party npm
 * package executed with Deno's all-permissions flag (`-A`) inside the job that
 * holds the JSR OIDC publishing credential:
 *
 * ```yaml
 * run: deno run -A npm:@cyclonedx/cdxgen -t deno -o sbom.cdx.json .
 * ```
 *
 * Four properties combined into a package-hijack path. The specifier resolved
 * `latest` fresh from the npm registry on every run, no quarantine covered an
 * inline workflow specifier, `-A` granted filesystem, network, environment,
 * subprocess and FFI access, and `permissions: id-token: write` is job-scoped —
 * so `ACTIONS_ID_TOKEN_REQUEST_URL` / `ACTIONS_ID_TOKEN_REQUEST_TOKEN` were
 * still live in the environment of that step. Anyone who compromised the
 * upstream package could mint a fresh `jsr.io`-audience token and tokenlessly
 * publish a trojanised `@stsoftware/neat-ai` — carrying valid Sigstore
 * provenance, because the legitimate pipeline minted it.
 *
 * The fix removes the credential from the blast radius (SBOM generation moved
 * to its own job with no `id-token` grant) and constrains the invocation
 * itself: a pinned version and an explicit permission set with no network, no
 * subprocess and no FFI, so the generator cannot reach the outside world even
 * if it is hijacked.
 *
 * These are "what" tests: they parse the committed workflow YAML and assert on
 * the resulting configuration, not on how any value happens to be written.
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
  needs?: string | string[];
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

async function readWorkflow(): Promise<Workflow> {
  return parse(await Deno.readTextFile(PUBLISH_WORKFLOW)) as Workflow;
}

/** The job id + step that invokes the CycloneDX generator. */
function findGenerator(
  wf: Workflow,
): { jobId: string; job: Job; step: Step } | undefined {
  for (const [jobId, job] of Object.entries(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (typeof step.run === "string" && /cdxgen/.test(step.run)) {
        return { jobId, job, step };
      }
    }
  }
  return undefined;
}

async function generator(): Promise<{ jobId: string; job: Job; run: string }> {
  const found = findGenerator(await readWorkflow());
  assert(
    found !== undefined,
    "publish.yml must run a CycloneDX generator to produce the SBOM",
  );
  return { jobId: found.jobId, job: found.job, run: found.step.run ?? "" };
}

/** Permission flags granted to the `deno run` that invokes the generator. */
function grantedFlags(run: string): string[] {
  return run.match(/--allow-[a-z-]+(?:=[^\s\\]*)?/g) ?? [];
}

Deno.test("the SBOM generator runs outside the JSR OIDC job (Issue #3668)", async () => {
  const { jobId, job } = await generator();
  const idToken = job.permissions?.["id-token"];
  assert(
    idToken === undefined || idToken === "none",
    `job "${jobId}" generates the SBOM with a third-party package but also ` +
      `grants id-token: ${idToken}. The OIDC credential is job-scoped, so it ` +
      "stays mintable for every later step — a hijacked generator could " +
      "tokenlessly publish to JSR. Generate the SBOM in a job with no " +
      "id-token grant.",
  );
});

Deno.test("the SBOM job requests only contents: read (Issue #3668)", async () => {
  const { jobId, job } = await generator();
  const perms = job.permissions;
  assert(
    perms !== undefined,
    `job "${jobId}" must declare an explicit least-privilege \`permissions:\` ` +
      "block rather than inheriting the workflow or repository default",
  );
  const granted = Object.entries(perms!)
    .filter(([, level]) => level !== "none")
    .map(([scope]) => scope)
    .sort();
  assert(
    granted.length === 1 && granted[0] === "contents",
    `job "${jobId}" needs nothing beyond \`contents: read\` to build and ` +
      `upload an SBOM, but grants: ${granted.join(", ") || "(nothing)"}`,
  );
});

Deno.test("the cdxgen specifier is version-pinned (Issue #3668)", async () => {
  const { run } = await generator();
  const specifiers = run.match(/npm:@cyclonedx\/cdxgen[^\s\\]*/g) ?? [];
  assert(specifiers.length > 0, "no npm:@cyclonedx/cdxgen specifier found");
  for (const specifier of specifiers) {
    assert(
      /^npm:@cyclonedx\/cdxgen@\d+\.\d+\.\d+$/.test(specifier),
      `'${specifier}' resolves \`latest\` from the npm registry on every run, ` +
        "so a malicious release executes with no review. Pin an exact " +
        "version (npm:@cyclonedx/cdxgen@x.y.z) so a bump is a reviewable diff.",
    );
  }
});

Deno.test("the cdxgen invocation does not use --allow-all (Issue #3668)", async () => {
  const { run } = await generator();
  assert(
    !/(^|\s)(-A|--allow-all)(\s|$)/.test(run),
    "the SBOM generator must not run with `-A` / `--allow-all`; grant only " +
      "the permissions it needs so a hijacked release cannot reach the " +
      "network, spawn processes, or load native code",
  );
});

Deno.test("the cdxgen invocation grants no network, subprocess or FFI access (Issue #3668)", async () => {
  const { run } = await generator();
  const flags = grantedFlags(run);
  // The SBOM is built from the committed deno.lock, so the generator needs no
  // egress at all — and without egress, subprocess/FFI escapes are the only
  // remaining way out of the sandbox.
  for (const forbidden of ["--allow-net", "--allow-run", "--allow-ffi"]) {
    const granted = flags.filter((f) => f.split("=")[0] === forbidden);
    assert(
      granted.length === 0,
      `the SBOM generator must not be granted ${forbidden} (got ` +
        `'${granted.join(", ")}'): it reads the committed deno.lock, so it ` +
        "needs no egress, and either flag re-opens the exfiltration path",
    );
  }
});

Deno.test("the cdxgen invocation does not rewrite the committed lockfile (Issue #3668)", async () => {
  const { run } = await generator();
  // Deno's module loader writes its own resolution of the generator into
  // deno.lock, and that write bypasses --allow-write. cdxgen reads deno.lock as
  // its input, so without --no-lock the generator's own dependency tree lands
  // inside the SBOM that describes the published package.
  assert(
    /(^|\s)--no-lock(\s|$)/.test(run),
    "the SBOM generator must run with --no-lock so resolving it does not " +
      "mutate the committed deno.lock — the same lockfile it reads to " +
      "enumerate the published dependency tree",
  );
});

Deno.test("the cdxgen invocation scopes its write access to the SBOM file (Issue #3668)", async () => {
  const { run } = await generator();
  const writes = grantedFlags(run).filter((f) =>
    f.split("=")[0] === "--allow-write"
  );
  assert(
    writes.length === 1,
    `expected exactly one --allow-write flag, got '${writes.join(", ")}'`,
  );
  const [, value] = writes[0].split("=");
  assert(
    value !== undefined && value.trim().length > 0,
    "--allow-write must be scoped to the SBOM output path, not granted " +
      "repository-wide — otherwise a hijacked generator can rewrite source " +
      "files that later CI jobs execute",
  );
  assert(
    /sbom/i.test(value),
    `--allow-write must name the SBOM output file, got '${value}'`,
  );
});
