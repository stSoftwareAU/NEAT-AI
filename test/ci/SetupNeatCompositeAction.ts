/**
 * Issue #3608 — the repeated "Deno + WASM sync" CI preamble lives in exactly
 * one place: the local composite action `.github/actions/setup-neat`.
 *
 * The same two steps — SHA-pinned `denoland/setup-deno`, then
 * `./build.sh --verify-only` (NEAT-AI-core WASM sync) — were copy-pasted across
 * six jobs in four workflows, so every pin bump or policy change needed six
 * coordinated edits. The `persist-credentials: false` hardening shows the cost:
 * it was rolled out as five separate issues (#3349, #3350, #3351, #3353,
 * #3355), one per copy.
 *
 * `actions/checkout` deliberately stays inline in each job. A local
 * `uses: ./…` action is resolved from `$GITHUB_WORKSPACE`, so the calling job
 * must already have checked the repository out before the composite action can
 * be loaded — a checkout *inside* the composite could never run.
 *
 * These are "what" tests: they parse the committed YAML and assert on the
 * resulting topology, not on the wording of any step. SHA-pinning of the
 * third-party actions inside the composite is covered by
 * `WorkflowActionPinning.ts`, which scans `.github/actions/` too.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const ACTION_DIR = ".github/actions/setup-neat";
const ACTION_PATH = `${ACTION_DIR}/action.yml`;
/** How workflows reference the composite action. */
const ACTION_REF = `./${ACTION_DIR}`;

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  shell?: string;
  with?: Record<string, unknown>;
}

interface CompositeAction {
  name?: string;
  description?: string;
  inputs?: Record<string, { description?: string; default?: unknown }>;
  runs?: { using?: string; steps?: Step[] };
}

interface Job {
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

async function readYaml<T>(relPath: string): Promise<T> {
  return parse(await Deno.readTextFile(join(REPO_ROOT, relPath))) as T;
}

async function readAction(): Promise<CompositeAction> {
  return await readYaml<CompositeAction>(ACTION_PATH);
}

function actionSteps(action: CompositeAction): Step[] {
  return action.runs?.steps ?? [];
}

function isCheckout(step: Step): boolean {
  return typeof step.uses === "string" &&
    step.uses.startsWith("actions/checkout@");
}

function stepLabel(step: Step): string {
  return step.name ?? step.uses ?? step.run?.trim().split("\n")[0] ??
    "<unnamed>";
}

/**
 * Every job whose preamble was consolidated onto the composite action, and
 * whether that job needs the WASM sync. The coverage `merge` job only reads
 * shard artefacts, so it opts out via `verify-wasm: "false"`.
 */
const CALL_SITES: { workflow: string; job: string; verifyWasm: boolean }[] = [
  {
    workflow: ".github/workflows/quality.yml",
    job: "quality",
    verifyWasm: true,
  },
  {
    workflow: ".github/workflows/coverage.yaml",
    job: "coverage",
    verifyWasm: true,
  },
  {
    workflow: ".github/workflows/coverage.yaml",
    job: "merge",
    verifyWasm: false,
  },
  { workflow: ".github/workflows/bench.yaml", job: "smoke", verifyWasm: true },
  {
    workflow: ".github/workflows/bench.yaml",
    job: "score-per-hour-regression",
    verifyWasm: true,
  },
  {
    workflow: ".github/workflows/publish.yml",
    job: "publish",
    verifyWasm: true,
  },
];

async function readJob(workflow: string, jobId: string): Promise<Job> {
  const wf = await readYaml<Workflow>(workflow);
  const job = wf.jobs?.[jobId];
  assert(job, `${workflow} must define a \`${jobId}\` job`);
  return job;
}

Deno.test(
  "the setup-neat composite action exists and is a composite action (Issue #3608)",
  async () => {
    const action = await readAction();
    assertEquals(
      action.runs?.using,
      "composite",
      `${ACTION_PATH} must declare \`runs.using: composite\``,
    );
    assert(
      typeof action.description === "string" && action.description.length > 0,
      `${ACTION_PATH} must carry a description (GitHub rejects an action without one)`,
    );
  },
);

Deno.test(
  "the composite action sets up Deno and syncs the WASM package (Issue #3608)",
  async () => {
    const steps = actionSteps(await readAction());

    const deno = steps.find((s) =>
      typeof s.uses === "string" && s.uses.startsWith("denoland/setup-deno@")
    );
    assert(
      deno !== undefined,
      `${ACTION_PATH} must install Deno via denoland/setup-deno so the pin lives in one place`,
    );

    const wasm = steps.find((s) =>
      /\.\/build\.sh\s+--verify-only/.test(s.run ?? "")
    );
    assert(
      wasm !== undefined,
      `${ACTION_PATH} must run \`./build.sh --verify-only\` so the WASM sync lives in one place`,
    );
    assertEquals(
      wasm.shell,
      "bash",
      `${ACTION_PATH} \`run:\` steps must declare \`shell: bash\` (required in composite actions)`,
    );
  },
);

Deno.test(
  "the composite action never resolves NEAT-AI-core HEAD (Issue #3608, #2439)",
  async () => {
    const source = await Deno.readTextFile(join(REPO_ROOT, ACTION_PATH));
    // CI must not auto-advance deno.json neatCore.rev — every build.sh call
    // carries an explicit flag.
    assert(
      !/\.\/build\.sh(?:\s*$|\s+(?!--))/m.test(source),
      `${ACTION_PATH} must not call ./build.sh without --verify-only (Issue #2439)`,
    );
  },
);

Deno.test(
  "the WASM sync is gated on the verify-wasm input (Issue #3608)",
  async () => {
    const action = await readAction();
    const input = action.inputs?.["verify-wasm"];
    assert(
      input !== undefined,
      `${ACTION_PATH} must declare a \`verify-wasm\` input so jobs that need no WASM bundle can opt out`,
    );
    assertEquals(
      String(input.default),
      "true",
      `${ACTION_PATH} \`verify-wasm\` must default to "true" — the sync is opt-out, so a new job cannot silently skip it`,
    );

    const wasm = actionSteps(action).find((s) =>
      /\.\/build\.sh/.test(s.run ?? "")
    );
    assert(
      typeof wasm?.if === "string" &&
        /inputs\.verify-wasm/.test(wasm.if),
      `${ACTION_PATH} must gate the WASM sync step on \`inputs.verify-wasm\``,
    );
  },
);

Deno.test(
  "the composite action does not check out the repository (Issue #3608)",
  async () => {
    const steps = actionSteps(await readAction());
    const checkout = steps.find(isCheckout);
    assert(
      checkout === undefined,
      `${ACTION_PATH} must not run actions/checkout. A local \`uses: ./…\` ` +
        "action is loaded from $GITHUB_WORKSPACE, so the calling job must " +
        "already have checked the repository out — a checkout inside the " +
        "composite could never run. Keep checkout inline in each job.",
    );
  },
);

for (const { workflow, job, verifyWasm } of CALL_SITES) {
  Deno.test(
    `${workflow} job "${job}" uses the setup-neat composite action (Issue #3608)`,
    async () => {
      const steps = (await readJob(workflow, job)).steps ?? [];
      const uses = steps.filter((s) => s.uses === ACTION_REF);
      assertEquals(
        uses.length,
        1,
        `${workflow} job "${job}" must reference \`${ACTION_REF}\` exactly once`,
      );
    },
  );

  Deno.test(
    `${workflow} job "${job}" checks out before the composite action (Issue #3608)`,
    async () => {
      const steps = (await readJob(workflow, job)).steps ?? [];
      const checkoutAt = steps.findIndex(isCheckout);
      const actionAt = steps.findIndex((s) => s.uses === ACTION_REF);
      assert(
        checkoutAt >= 0,
        `${workflow} job "${job}" must keep an inline actions/checkout step — a local composite action cannot check the repository out for itself`,
      );
      assert(
        checkoutAt < actionAt,
        `${workflow} job "${job}" must check out before \`${ACTION_REF}\`; the action is loaded from $GITHUB_WORKSPACE`,
      );
    },
  );

  Deno.test(
    `${workflow} job "${job}" no longer inlines the shared preamble (Issue #3608)`,
    async () => {
      const steps = (await readJob(workflow, job)).steps ?? [];
      for (const step of steps) {
        assert(
          !(step.uses ?? "").startsWith("denoland/setup-deno@"),
          `${workflow} job "${job}" step "${
            stepLabel(step)
          }" inlines denoland/setup-deno — use \`${ACTION_REF}\` so the pin lives in one place`,
        );
        assert(
          !/\.\/build\.sh\b/.test(step.run ?? ""),
          `${workflow} job "${job}" step "${
            stepLabel(step)
          }" inlines ./build.sh — use \`${ACTION_REF}\` so the WASM sync lives in one place`,
        );
      }
    },
  );

  Deno.test(
    `${workflow} job "${job}" requests verify-wasm=${verifyWasm} (Issue #3608)`,
    async () => {
      const steps = (await readJob(workflow, job)).steps ?? [];
      const step = steps.find((s) => s.uses === ACTION_REF);
      assert(step, `${workflow} job "${job}" must use \`${ACTION_REF}\``);
      const raw = step.with?.["verify-wasm"];
      // Omitted means the "true" default.
      const resolved = raw === undefined ? "true" : String(raw);
      assertEquals(
        resolved,
        String(verifyWasm),
        `${workflow} job "${job}" must run with verify-wasm=${verifyWasm}`,
      );
    },
  );
}
