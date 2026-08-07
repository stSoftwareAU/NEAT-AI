/**
 * Issue #3669 — CODEOWNERS covered the workflow *files* but not the repository
 * *code those workflows execute*, so ownership stopped one line short of the
 * privileged credential.
 *
 * `publish.yml`'s `publish` job holds `permissions: id-token: write` — the JSR
 * OIDC credential backing tokenless publishing of `@stsoftware/neat-ai`. That
 * grant is job-scoped, so every step in the job can mint the token. Two of the
 * things the job executes lived outside the gate: `./build.sh --verify-only`
 * (reached through the owned composite action `.github/actions/setup-neat`,
 * whose only instruction is to run the unowned script) and
 * `scripts/verify_provenance.ts` — which is itself the provenance gate, so an
 * unreviewed edit could disable the control that would report a bad publish.
 *
 * Rather than pin a hand-written list of paths, this test derives the
 * requirement from the workflows themselves: for every job granting
 * `id-token: write`, every repository file the job runs (directly, or through a
 * local composite action) must resolve to a CODEOWNERS owner. A new script
 * added to a privileged job therefore fails here until the gate is extended to
 * cover it.
 */

import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";
import { ownersFor, parseCodeowners, readCodeowners } from "./_codeowners.ts";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOWS_DIR = join(REPO_ROOT, ".github/workflows");

interface Step {
  uses?: string;
  run?: string;
}

interface Job {
  permissions?: Record<string, string>;
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

/** A repository file executed by a privileged job, with its provenance. */
interface ExecutedPath {
  /** Repo-relative path, e.g. `build.sh`. */
  path: string;
  /** Where it was found, e.g. `.github/workflows/publish.yml (job: publish)`. */
  origin: string;
}

/** Characters that separate arguments in a shell `run:` block. */
const TOKEN_SEPARATORS = /[\s;|&()<>"'`=,]+/;

/**
 * Repo-relative file paths named by a shell snippet.
 *
 * Deliberately conservative: a token counts only when it names a file that
 * exists in the checkout, so command names, flags and expressions fall away.
 */
export function referencedFiles(run: string): string[] {
  const found = new Set<string>();
  for (const rawToken of run.split(TOKEN_SEPARATORS)) {
    // Skip flags and anything holding a shell/Actions expression — those
    // cannot be resolved statically.
    if (rawToken.startsWith("-") || /[$\\{}]/.test(rawToken)) continue;
    const token = rawToken.replace(/^\.\//, "").replace(/[.,:]+$/, "");
    if (token === "" || token.startsWith("/")) continue;
    if (!/^[A-Za-z0-9._][A-Za-z0-9._/-]*$/.test(token)) continue;
    try {
      if (Deno.statSync(join(REPO_ROOT, token)).isFile) found.add(token);
    } catch {
      // Not a file in the checkout (a command name, or an artefact produced at
      // run time) — nothing to own.
    }
  }
  return [...found];
}

/** The `action.yml` / `action.yaml` implementing a local `uses: ./…` step. */
function localActionManifest(uses: string): string | null {
  const dir = uses.replace(/^\.\//, "");
  for (const name of ["action.yml", "action.yaml"]) {
    const rel = join(dir, name);
    try {
      if (Deno.statSync(join(REPO_ROOT, rel)).isFile) return rel;
    } catch {
      // Try the other extension.
    }
  }
  return null;
}

/** Files a step executes, following local composite actions one level deep. */
function filesForStep(step: Step, origin: string): ExecutedPath[] {
  if (typeof step.run === "string") {
    return referencedFiles(step.run).map((path) => ({ path, origin }));
  }
  if (typeof step.uses === "string" && step.uses.startsWith("./")) {
    const manifest = localActionManifest(step.uses);
    if (manifest === null) return [];
    const action = parse(
      Deno.readTextFileSync(join(REPO_ROOT, manifest)),
    ) as { runs?: { steps?: Step[] } };
    const nested = (action.runs?.steps ?? []).flatMap((s) =>
      filesForStep(s, `${origin} → ${manifest}`)
    );
    return [{ path: manifest, origin }, ...nested];
  }
  return [];
}

/** Every repository file executed by a job granting `id-token: write`. */
export async function privilegedExecutedPaths(): Promise<ExecutedPath[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
    if (entry.isFile && /\.ya?ml$/.test(entry.name)) names.push(entry.name);
  }
  const sources = await Promise.all(
    names.map((name) => Deno.readTextFile(join(WORKFLOWS_DIR, name))),
  );

  const executed = new Map<string, ExecutedPath>();
  names.forEach((name, index) => {
    const rel = join(".github/workflows", name);
    const workflow = parse(sources[index]) as Workflow;
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      if (job.permissions?.["id-token"] !== "write") continue;
      const origin = `${rel} (job: ${jobId})`;
      for (const step of job.steps ?? []) {
        // First origin wins — one entry per distinct file keeps the failure
        // message readable.
        for (const found of filesForStep(step, origin)) {
          if (!executed.has(found.path)) executed.set(found.path, found);
        }
      }
    }
  });
  return [...executed.values()];
}

Deno.test("a job holding the JSR OIDC credential exists and executes repository code (Issue #3669)", async () => {
  const executed = await privilegedExecutedPaths();
  assert(
    executed.length > 0,
    "no `id-token: write` job executing repository code was found — this test " +
      "cannot protect what it cannot see. If the publish job was restructured, " +
      "update the discovery in privilegedExecutedPaths().",
  );
});

Deno.test("every file executed by an `id-token: write` job has a code owner (Issue #3669)", async () => {
  const file = await readCodeowners();
  assert(file !== null, "CODEOWNERS file is required");
  const rules = parseCodeowners(file.source);

  const unowned = (await privilegedExecutedPaths())
    .filter(({ path }) => ownersFor(rules, path).length === 0);

  assert(
    unowned.length === 0,
    "these files run inside a job holding the JSR OIDC `id-token`, but no " +
      "CODEOWNERS rule covers them, so they can be changed without the " +
      "code-owner review the gate exists to force:\n" +
      unowned.map(({ path, origin }) => `  - ${path} — via ${origin}`)
        .join("\n"),
  );
});

Deno.test("the publish gate's own verifier is owned (Issue #3669)", async () => {
  const file = await readCodeowners();
  assert(file !== null, "CODEOWNERS file is required");
  const rules = parseCodeowners(file.source);

  // The provenance verifier is the control that turns a bad publish red. If it
  // is editable in the same unreviewed PR that trojanises the pipeline, the
  // gate defends nothing — so pin its ownership independently of discovery.
  const owners = ownersFor(rules, "scripts/verify_provenance.ts");
  assert(
    owners.length > 0,
    "`scripts/verify_provenance.ts` is the provenance gate for the JSR " +
      "publish; it must require code-owner review",
  );
});
