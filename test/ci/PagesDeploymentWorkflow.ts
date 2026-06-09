import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

/**
 * Issue #2877 — migrate GitHub Pages off the legacy "deploy from a branch"
 * build so the project stops triggering GitHub's managed
 * `pages-build-deployment` workflow, which still runs `actions/checkout@v4`
 * and `actions/upload-artifact@v4` on the deprecated Node 20 runtime.
 *
 * The fix is a repo-owned Pages deployment workflow that builds the `docs/`
 * site and publishes it through the modern, SHA-pinned Pages actions
 * (`actions/configure-pages`, `actions/jekyll-build-pages`,
 * `actions/upload-pages-artifact`, `actions/deploy-pages`) — all of which run
 * on Node 24 / Docker rather than Node 20.
 *
 * This is a "what" test: it parses the committed workflow YAML and asserts on
 * the resulting configuration, not on how the value happens to be written.
 */

interface Step {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface Job {
  "runs-on"?: string;
  permissions?: Record<string, string>;
  steps?: Step[];
  needs?: string | string[];
  environment?: unknown;
}

interface Workflow {
  name?: string;
  on?: unknown;
  permissions?: Record<string, string>;
  jobs?: Record<string, Job>;
}

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const PAGES_WORKFLOW = join(REPO_ROOT, ".github/workflows/pages.yml");

async function readPagesWorkflow(): Promise<Workflow> {
  const text = await Deno.readTextFile(PAGES_WORKFLOW);
  return parse(text) as Workflow;
}

function allSteps(wf: Workflow): Step[] {
  const steps: Step[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) steps.push(step);
  }
  return steps;
}

/** Strip the `@<ref>` suffix from a `uses:` reference. */
function actionName(uses: string): string {
  return uses.split("@")[0];
}

Deno.test("Pages deployment workflow exists and parses (Issue #2877)", async () => {
  const wf = await readPagesWorkflow();
  assert(typeof wf === "object" && wf !== null, "pages.yml did not parse");
  assert(
    wf.jobs && Object.keys(wf.jobs).length > 0,
    "pages.yml declares no jobs",
  );
});

Deno.test(
  "Pages workflow publishes via actions/deploy-pages, not the legacy branch build (Issue #2877)",
  async () => {
    const wf = await readPagesWorkflow();
    const actions = allSteps(wf)
      .map((s) => s.uses)
      .filter((u): u is string => typeof u === "string")
      .map(actionName);

    assert(
      actions.includes("actions/deploy-pages"),
      "pages.yml must deploy through actions/deploy-pages (the modern, " +
        "GitHub-Actions-based Pages deployment) so the legacy " +
        "pages-build-deployment runner is no longer used",
    );
    assert(
      actions.includes("actions/upload-pages-artifact"),
      "pages.yml must upload the built site with actions/upload-pages-artifact",
    );
    assert(
      actions.includes("actions/configure-pages"),
      "pages.yml must call actions/configure-pages before deploying",
    );
  },
);

Deno.test(
  "Pages workflow builds the docs/ directory it currently serves (Issue #2877)",
  async () => {
    const wf = await readPagesWorkflow();
    const build = allSteps(wf).find(
      (s) =>
        typeof s.uses === "string" &&
        actionName(s.uses) === "actions/jekyll-build-pages",
    );
    assert(
      build !== undefined,
      "pages.yml must build the site with actions/jekyll-build-pages so the " +
        "rendered output matches the previous legacy `/docs` branch build",
    );
    assertEquals(
      build.with?.source,
      "./docs",
      "jekyll-build-pages must build from ./docs (the existing Pages source)",
    );
  },
);

Deno.test(
  "Pages deploy job grants the pages:write and id-token:write scopes deploy-pages needs (Issue #2877)",
  async () => {
    const wf = await readPagesWorkflow();
    // Permissions may be set at the top level or on the deploying job; collect
    // the effective scopes that apply to the deploy-pages step.
    const topLevel = wf.permissions ?? {};
    const deployJob = Object.values(wf.jobs ?? {}).find((job) =>
      (job.steps ?? []).some(
        (s) =>
          typeof s.uses === "string" &&
          actionName(s.uses) === "actions/deploy-pages",
      )
    );
    assert(deployJob !== undefined, "no job runs actions/deploy-pages");
    const effective = { ...topLevel, ...(deployJob.permissions ?? {}) };

    assertEquals(
      effective.pages,
      "write",
      "the deploy job needs `pages: write` for actions/deploy-pages",
    );
    assertEquals(
      effective["id-token"],
      "write",
      "the deploy job needs `id-token: write` for actions/deploy-pages " +
        "OIDC verification",
    );
  },
);

Deno.test(
  "Pages workflow uses only supported runtimes — no @v4 Node 20 actions (Issue #2877)",
  async () => {
    const wf = await readPagesWorkflow();
    // The deprecation the issue tracks is actions/checkout@v4 and
    // actions/upload-artifact@v4 running on Node 20. No actual `uses:`
    // directive may pin either action to its Node 20 `@v4` major (header
    // comments that merely mention the deprecation are not `uses:` directives
    // and so are correctly ignored).
    for (const uses of allSteps(wf).map((s) => s.uses)) {
      if (typeof uses !== "string") continue;
      assert(
        !/^actions\/upload-artifact@v4(\.|$)/.test(uses),
        `pages.yml must not use the deprecated ${uses}`,
      );
      assert(
        !/^actions\/checkout@v4(\.|$)/.test(uses),
        `pages.yml must not use the deprecated ${uses}`,
      );
    }
  },
);
