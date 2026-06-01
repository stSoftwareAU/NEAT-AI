import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/yaml";

/**
 * Verifies that pile-up-prone `.github/workflows/*.y*ml` files declare a
 * top-level `concurrency:` group so superseded runs are cancelled (Issue
 * #2842 — workflow resource-hygiene hardening).
 *
 * When a contributor pushes several commits to a PR branch in quick
 * succession, every push starts a fresh run of each `pull_request` workflow
 * while the earlier runs keep executing. On the heavier jobs (`coverage`,
 * `quality`) those superseded runs each hold a runner for the full
 * test/build cycle, wasting minutes quota and delaying the run that reflects
 * the latest commit. A `concurrency:` group keyed on the workflow and ref,
 * with `cancel-in-progress: true`, cancels the stale run as soon as a newer
 * one starts.
 *
 * The release/publish workflows trigger on `push: Develop`; they may declare
 * concurrency to serialise releases, but MUST keep `cancel-in-progress:
 * false` so an in-flight release or JSR publish is never interrupted
 * mid-run.
 *
 * This is a "what" test: it parses the committed workflow YAML and asserts on
 * the resulting configuration, not on how the value happens to be written.
 */

interface Concurrency {
  group?: string;
  "cancel-in-progress"?: boolean | string;
}

interface Workflow {
  name?: string;
  concurrency?: Concurrency | string;
}

const WORKFLOW_DIR = ".github/workflows";

// PR-triggered workflows where rapid successive pushes queue redundant runs.
// Each MUST cancel superseded runs (cancel-in-progress: true).
const PILE_UP_PRONE = [
  "actionlint.yml",
  "coverage.yaml",
  "dependency-review.yml",
  "markdown-lint.yml",
  "quality.yml",
  "semgrep.yml",
  "shellcheck.yml",
  "spellcheck.yaml",
  "update-package-version.yml",
];

// Release/publish workflows trigger on push: Develop. They may serialise via a
// concurrency group, but an in-flight run must never be cancelled mid-release.
const RELEASE_WORKFLOWS = [
  "github-release.yml",
  "publish.yml",
];

async function readWorkflow(name: string): Promise<Workflow> {
  const text = await Deno.readTextFile(`${WORKFLOW_DIR}/${name}`);
  return parse(text) as Workflow;
}

function asConcurrency(wf: Workflow): Concurrency {
  const c = wf.concurrency;
  assert(
    c !== undefined && typeof c === "object",
    "expected a top-level concurrency: block (object with group and " +
      "cancel-in-progress)",
  );
  return c as Concurrency;
}

for (const name of PILE_UP_PRONE) {
  Deno.test(
    `${name} declares a concurrency group that cancels superseded runs (Issue #2842)`,
    async () => {
      const wf = await readWorkflow(name);
      const concurrency = asConcurrency(wf);

      const group = concurrency.group;
      assert(
        typeof group === "string" && group.length > 0,
        `${name} concurrency.group must be a non-empty string`,
      );
      // Keyed on the workflow + ref so concurrent runs of the SAME workflow on
      // the SAME ref collapse, without colliding across different workflows or
      // refs.
      assert(
        group.includes("github.workflow"),
        `${name} concurrency.group must include github.workflow so groups do ` +
          `not collide across workflows; got: ${group}`,
      );
      assert(
        group.includes("github.ref") || group.includes("github.head_ref"),
        `${name} concurrency.group must include the ref (github.ref or ` +
          `github.head_ref) so distinct branches/PRs do not collide; got: ${group}`,
      );

      assertEquals(
        concurrency["cancel-in-progress"],
        true,
        `${name} must set cancel-in-progress: true so a stale run is cancelled ` +
          `as soon as a newer one starts`,
      );
    },
  );
}

for (const name of RELEASE_WORKFLOWS) {
  Deno.test(
    `${name} never cancels an in-flight release/publish (Issue #2842)`,
    async () => {
      const wf = await readWorkflow(name);
      // Concurrency is optional here, but if present it must not interrupt an
      // in-flight release.
      if (wf.concurrency === undefined) return;
      const concurrency = asConcurrency(wf);
      assertEquals(
        concurrency["cancel-in-progress"],
        false,
        `${name} must keep cancel-in-progress: false so an in-flight release ` +
          `or JSR publish is never interrupted mid-run`,
      );
    },
  );
}
