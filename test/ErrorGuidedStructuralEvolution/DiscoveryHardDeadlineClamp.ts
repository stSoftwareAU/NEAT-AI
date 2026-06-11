/**
 * Issue #2898: clamp discovery recording and analysis-timeout extensions to the
 * absolute hard deadline (T+15).
 *
 * The worker re-anchors its relative record/analysis budgets at `Date.now()`
 * when it dequeues a request, so a queue delay silently shifts the absolute
 * completion time past the caller's deadline. These tests prove every
 * per-discovery deadline — the recording `timeoutTS`, the analysis extension,
 * and `refreshAnalysisTimeout` top-ups — is clamped to the absolute
 * `discoveryHardDeadlineTS` cap. Timestamps are injected (a near-future or
 * already-past cap); the assertions compare against the cap, so no real waiting
 * is required (#2888 policy).
 */
import { assert } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { DataRecorder } from "@architecture/ErrorGuidedStructuralEvolution/DataRecorder.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type { NeatConfig } from "@config/NeatConfig.ts";
import { initWasmForTests } from "../_initWasm.ts";

function makeTestCreature(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-a", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-a", weight: -0.5 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 0.5 },
    ],
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/** Build a config with an injected absolute hard deadline (epoch ms). */
function configWithHardDeadline(
  hardDeadlineTS: number | undefined,
  overrides: Record<string, unknown> = {},
): NeatConfig {
  const base = createNeatConfig({
    discoveryRecordTimeOutMinutes: 5,
    discoveryAnalysisTimeoutMinutes: 10,
    ...overrides,
  });
  return { ...base, discoveryHardDeadlineTS: hardDeadlineTS } as NeatConfig;
}

Deno.test("DataRecorder constructor clamps recording timeoutTS to a near-future hard deadline", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  // Cap 5 seconds out — far inside the 5-minute record budget.
  const cap = Date.now() + 5_000;
  const recorder = new DataRecorder(creature, configWithHardDeadline(cap), {});
  assert(
    recorder.currentTimeoutTS <= cap,
    `timeoutTS ${recorder.currentTimeoutTS} must not exceed cap ${cap}`,
  );
});

Deno.test("DataRecorder constructor clamps recording timeoutTS to an already-past hard deadline", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const cap = Date.now() - 1_000; // hard deadline already elapsed in the queue
  const recorder = new DataRecorder(creature, configWithHardDeadline(cap), {});
  assert(
    recorder.currentTimeoutTS <= cap,
    `timeoutTS ${recorder.currentTimeoutTS} must not exceed past cap ${cap}`,
  );
});

Deno.test("DataRecorder leaves timeoutTS unclamped when no hard deadline is configured", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const before = Date.now();
  const recorder = new DataRecorder(
    creature,
    configWithHardDeadline(undefined),
    {},
  );
  // Record budget is 5 minutes; without a cap the deadline sits ~5 min out.
  const budgetMs = 5 * 60 * 1000;
  assert(
    recorder.currentTimeoutTS >= before + budgetMs - 2_000,
    `Expected unclamped timeoutTS ~${
      before + budgetMs
    }, got ${recorder.currentTimeoutTS}`,
  );
});

Deno.test("DataRecorder.extendTimeoutForAnalysisPhase clamps analysis deadline to the hard cap", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const cap = Date.now() + 3_000; // cap well inside the 10-minute analysis budget
  const config = configWithHardDeadline(cap);
  const recorder = new DataRecorder(creature, config, {});
  const ds = new DiscoverStructure(creature, 300, 100, {});

  recorder.extendTimeoutForAnalysisPhase(ds);

  assert(
    recorder.currentAnalysisDeadlineAt !== undefined &&
      recorder.currentAnalysisDeadlineAt <= cap,
    `analysisDeadlineAt ${recorder.currentAnalysisDeadlineAt} must not exceed cap ${cap}`,
  );
  assert(
    recorder.currentTimeoutTS <= cap,
    `timeoutTS ${recorder.currentTimeoutTS} must not exceed cap ${cap}`,
  );
  assert(
    ds.getTimeoutTS() <= cap,
    `DiscoverStructure timeoutTS ${ds.getTimeoutTS()} must not exceed cap ${cap}`,
  );
});

Deno.test("DataRecorder.refreshAnalysisTimeout never moves the deadline past the hard cap", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const cap = Date.now() + 4_000;
  const config = configWithHardDeadline(cap);
  const recorder = new DataRecorder(creature, config, {});
  const ds = new DiscoverStructure(creature, 300, 100, {});

  recorder.extendTimeoutForAnalysisPhase(ds);
  // A top-up must stay clamped — the refreshed deadline can only shrink toward
  // or hold at the cap, never overshoot it.
  recorder.refreshAnalysisTimeout(ds);

  assert(
    recorder.currentTimeoutTS <= cap,
    `post-refresh timeoutTS ${recorder.currentTimeoutTS} must not exceed cap ${cap}`,
  );
  assert(
    ds.getTimeoutTS() <= cap,
    `post-refresh DiscoverStructure timeoutTS ${ds.getTimeoutTS()} must not exceed cap ${cap}`,
  );
});

Deno.test("DiscoverStructure.extendTimeoutForAnalysis clamps to the supplied hard cap", () => {
  const creature = makeTestCreature();
  const ds = new DiscoverStructure(creature, 300, 100, {});
  const cap = Date.now() + 2_000;
  // Ask for a 10-minute extension but cap 2s out — must land on the cap.
  ds.extendTimeoutForAnalysis(600, cap);
  assert(
    ds.getTimeoutTS() <= cap,
    `timeoutTS ${ds.getTimeoutTS()} must not exceed cap ${cap}`,
  );
});

Deno.test("DiscoverStructure.extendTimeoutForAnalysis remembers the cap for later top-ups", () => {
  const creature = makeTestCreature();
  const ds = new DiscoverStructure(creature, 300, 100, {});
  const cap = Date.now() + 2_000;
  ds.extendTimeoutForAnalysis(600, cap);
  // A later top-up with no cap supplied must still honour the remembered cap.
  ds.extendTimeoutForAnalysis(600);
  assert(
    ds.getTimeoutTS() <= cap,
    `timeoutTS ${ds.getTimeoutTS()} must not exceed remembered cap ${cap}`,
  );
});

Deno.test("DiscoverStructure.extendTimeoutForAnalysis is unchanged when no cap is supplied", () => {
  const creature = makeTestCreature();
  const ds = new DiscoverStructure(creature, 300, 100, {});
  const before = Date.now();
  ds.extendTimeoutForAnalysis(600); // 10 minutes, no cap
  const tenMinutes = 600 * 1000;
  assert(
    ds.getTimeoutTS() >= before + tenMinutes - 2_000,
    `Expected unclamped timeoutTS ~${
      before + tenMinutes
    }, got ${ds.getTimeoutTS()}`,
  );
});
