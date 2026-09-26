/**
 * Issue #4040: the shared `setup-neat` composite action caches `DENO_DIR`,
 * restoring on every run but writing only from `push: Develop` runs, so a
 * pull request can never poison the cache Develop and later PRs read.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const ACTION_PATH = ".github/actions/setup-neat/action.yml";

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}

async function actionSteps(): Promise<Step[]> {
  const source = await Deno.readTextFile(join(REPO_ROOT, ACTION_PATH));
  const action = parse(source) as { runs: { steps: Step[] } };
  return action.runs.steps;
}

const CACHE_DIR = "${{ runner.temp }}/deno-dir";
const PUSH_TO_DEVELOP =
  /github\.event_name == 'push'.*github\.ref == 'refs\/heads\/Develop'/;

function usesAction(step: Step, action: string): boolean {
  return step.uses?.split("@")[0] === action;
}

function indexOfUses(steps: Step[], action: string): number {
  return steps.findIndex((s) => usesAction(s, action));
}

Deno.test("setup-neat points DENO_DIR at the cached directory", async () => {
  const steps = await actionSteps();
  const exporter = steps.findIndex((s) =>
    s.run?.includes("DENO_DIR=${RUNNER_TEMP}/deno-dir") &&
    s.run.includes("GITHUB_ENV")
  );
  assert(exporter >= 0, "expected a step exporting DENO_DIR to $GITHUB_ENV");
  assert(
    exporter < indexOfUses(steps, "denoland/setup-deno"),
    "DENO_DIR must be set before Deno is installed or used",
  );
});

Deno.test("setup-neat restores DENO_DIR keyed on deno.lock", async () => {
  const steps = await actionSteps();
  const i = indexOfUses(steps, "actions/cache/restore");
  assert(i >= 0, "expected an actions/cache/restore step");
  const restore = steps[i];
  assertEquals(restore.if, undefined, "every run must restore the cache");
  assertEquals(restore.with?.path, CACHE_DIR);
  assert(
    restore.with?.key?.includes("hashFiles('deno.lock')"),
    `key must hash deno.lock, got ${restore.with?.key}`,
  );
  const prefix = restore.with?.key?.split("${{ hashFiles")[0] ?? "";
  assert(prefix.length > 0, "key must carry a prefix for restore-keys");
  assertEquals(restore.with?.["restore-keys"]?.trim(), prefix);
  assert(restore.id, "restore step needs an id so the save can read its key");
  assert(
    i < indexOfUses(steps, "denoland/setup-deno"),
    "restore must run before Deno fetches anything",
  );
});

Deno.test("setup-neat never writes the cache from a pull request", async () => {
  const steps = await actionSteps();
  assertEquals(
    indexOfUses(steps, "actions/cache"),
    -1,
    "the combined actions/cache step saves on every event — use restore/save",
  );
  const saves = steps.filter((s) => usesAction(s, "actions/cache/save"));
  assertEquals(saves.length, 1, "expected exactly one actions/cache/save step");
  const [save] = saves;
  assert(
    PUSH_TO_DEVELOP.test(save.if ?? ""),
    `save must be gated on a push to Develop, got: ${save.if}`,
  );
  assertEquals(save.with?.path, CACHE_DIR);
  const restoreId = steps.find((s) => usesAction(s, "actions/cache/restore"))
    ?.id;
  assertEquals(
    save.with?.key,
    `\${{ steps.${restoreId}.outputs.cache-primary-key }}`,
  );
});

Deno.test("setup-neat warms the cache from the lockfile before saving", async () => {
  const steps = await actionSteps();
  const warm = steps.findIndex((s) => s.run?.includes("deno install --frozen"));
  assert(warm >= 0, "expected a `deno install --frozen` warm-up step");
  assert(
    PUSH_TO_DEVELOP.test(steps[warm].if ?? ""),
    "warm-up only needs to run where the cache is saved",
  );
  assert(warm > indexOfUses(steps, "denoland/setup-deno"));
  assert(warm < indexOfUses(steps, "actions/cache/save"));
});

Deno.test("WASM verification does not depend on the cache", async () => {
  const steps = await actionSteps();
  const verify = steps.find((s) => s.run?.includes("build.sh --verify-only"));
  assert(verify, "expected the build.sh --verify-only step");
  assertEquals(verify.if, "${{ inputs.verify-wasm == 'true' }}");
});
