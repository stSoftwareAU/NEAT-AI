/**
 * Live numeric parity between the two dataset-scoring engines (Issue #3854).
 *
 * Nothing in either repository compared the engines' actual numbers on real
 * data before this test: `test/score/WasmJsScoreParity.ts` lost its second
 * engine in Issue #1236 and now only asserts finiteness, `scripts/parity-gate.sh`
 * is a NEAT-AI-core WASM re-pin gate, and `rust_scorer`'s own `cost_parity.rs`
 * transcribes the TypeScript formulae as constants rather than executing them.
 * That gap is why the RMSE divergence (Issue #3853) went unnoticed.
 *
 * This test runs the **real** `rust_scorer` binary and `evaluateDir` with the
 * native path switched off over the same dataset, for every built-in cost and
 * both topology styles, and asserts the two agree.
 *
 * Issue #3867 extends it past `error` to the `score` field `Fitness` discards —
 * see the score-formula section at the bottom of this file.
 *
 * When the binary cannot be resolved the lane is skipped rather than failed —
 * `quality.sh` resolves it (PATH, `--rust-scorer-bin`, sibling
 * `../NEAT-AI-scorer`) for the default run, so CI always exercises it.
 */
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertRejects,
} from "@std/assert";
import { BUILT_IN_COST_NAMES, type BuiltInCostName, Costs } from "@costs";
import type { Creature } from "@creature";
import type { RequiredOutputRange } from "@config/OutputRangeConfig.ts";
import { DEFAULT_COST_OF_GROWTH } from "@config/NeatConfig.ts";
import { calculate as calculateScore } from "@architecture/Score.ts";
import { tryBatchScoreWithRustScorer } from "../../src/score/BatchRustScorerBridge.ts";
import { resolveRecurrentDirectorySupport } from "../../src/score/RecurrentDirectoryProbe.ts";
import { initWasmForTests } from "../_initWasm.ts";
import {
  buildScoringCreature,
  liveScorerConfig,
  makeScoringDataDir,
  relativeDifference,
  resolveRustScorerBinary,
  typescriptScorerConfig,
} from "./NativeScorerFixtures.ts";

const BINARY = resolveRustScorerBinary();
const SKIP = BINARY === undefined;

/**
 * Costs whose two engines are known to disagree, with the issue tracking the
 * fix. Entries are asserted to *still* disagree below, so a stale entry fails
 * loudly the moment its divergence is fixed instead of quietly suppressing a
 * cost forever.
 *
 * Empty is the healthy state: every built-in cost is covered by the ordinary
 * parity assertions. The RMSE entry left here after Issue #3853 was fixed is
 * what Issue #3883 removed — add an entry only alongside an open issue, and
 * delete it in the same change that fixes the divergence.
 */
const KNOWN_DIVERGENCES: ReadonlyMap<string, string> = new Map<
  string,
  string
>();

/**
 * Agreement tolerance. The two engines accumulate in f64 but activate in f32,
 * so exact equality is not available; the observed spread across all costs is
 * below 1e-6 relative.
 */
const PARITY_REL_TOLERANCE = 1e-5;

/** One (cost, topology) parity measurement. */
async function measure(
  costName: string,
  selfLoop: boolean,
): Promise<{ native: number; typescript: number }> {
  await initWasmForTests();
  const cost = Costs.find(costName);
  const dataDir = makeScoringDataDir();
  try {
    const creature = buildScoringCreature(selfLoop);
    creature.clearState();
    const native = await creature.evaluateDir(
      dataDir,
      cost,
      false,
      undefined,
      undefined,
      liveScorerConfig(BINARY!),
    );
    creature.clearState();
    const typescript = await creature.evaluateDir(
      dataDir,
      cost,
      false,
      undefined,
      undefined,
      typescriptScorerConfig(BINARY!),
    );
    return { native: native.error, typescript: typescript.error };
  } finally {
    await Deno.remove(dataDir, { recursive: true });
  }
}

/** Register the agreement test for one (cost, topology) pair. */
function registerAgreementTest(costName: string, selfLoop: boolean): void {
  const topology = selfLoop ? "recurrent" : "forwardOnly";
  Deno.test({
    name:
      `Dataset scoring parity: rust_scorer and TypeScript agree for ${costName} (${topology})`,
    ignore: SKIP,
    async fn() {
      const { native, typescript } = await measure(costName, selfLoop);
      assert(
        Number.isFinite(native) && Number.isFinite(typescript),
        `${costName}/${topology}: expected finite errors, got ` +
          `native=${native} typescript=${typescript}`,
      );
      const rel = relativeDifference(native, typescript);
      assert(
        rel <= PARITY_REL_TOLERANCE,
        `${costName}/${topology}: engines disagree — native=${native} ` +
          `typescript=${typescript} (relative difference ${rel}, ` +
          `tolerance ${PARITY_REL_TOLERANCE}). One of the two ` +
          `implementations is wrong; fix it rather than widening this ` +
          `tolerance.`,
      );
    },
  });
}

/**
 * Register the "still broken" test for a {@link KNOWN_DIVERGENCES} entry, so a
 * fixed divergence cannot leave a cost permanently excluded from the parity
 * assertions above.
 */
function registerKnownDivergenceTest(costName: string, tracking: string): void {
  Deno.test({
    name:
      `Dataset scoring parity: ${costName} is still a known divergence (${tracking})`,
    ignore: SKIP,
    async fn() {
      const { native, typescript } = await measure(costName, false);
      const rel = relativeDifference(native, typescript);
      assert(
        rel > PARITY_REL_TOLERANCE,
        `${costName} now agrees between the engines (native=${native} ` +
          `typescript=${typescript}). The divergence tracked by ${tracking} ` +
          `has been fixed — delete the KNOWN_DIVERGENCES entry in ` +
          `test/score/RustScorerDatasetParity.ts so the cost is covered by ` +
          `the parity assertions again.`,
      );
    },
  });
}

for (const costName of BUILT_IN_COST_NAMES) {
  if (KNOWN_DIVERGENCES.has(costName)) continue;
  for (const selfLoop of [false, true]) {
    registerAgreementTest(costName, selfLoop);
  }
}

for (const [costName, tracking] of KNOWN_DIVERGENCES) {
  registerKnownDivergenceTest(costName, tracking);
}

Deno.test({
  name:
    "Dataset scoring parity: outputRanges penalty survives with the native scorer enabled",
  ignore: SKIP,
  async fn() {
    await initWasmForTests();
    // A range the creature's logistic output cannot satisfy, so the penalty
    // dominates the raw cost and its absence is unmistakable.
    const ranges: ReadonlyArray<RequiredOutputRange> = [
      { min: 0.95, max: 0.99, penaltyWeight: 2 },
    ];
    const cost = Costs.find("MSE");
    const dataDir = makeScoringDataDir();
    try {
      const creature = buildScoringCreature();
      creature.clearState();
      const withNative = await creature.evaluateDir(
        dataDir,
        cost,
        false,
        ranges,
        undefined,
        liveScorerConfig(BINARY!),
      );
      creature.clearState();
      const withoutNative = await creature.evaluateDir(
        dataDir,
        cost,
        false,
        ranges,
        undefined,
        typescriptScorerConfig(BINARY!),
      );
      creature.clearState();
      const unconstrained = await creature.evaluateDir(
        dataDir,
        cost,
        false,
        undefined,
        undefined,
        typescriptScorerConfig(BINARY!),
      );

      assert(
        withoutNative.error > unconstrained.error,
        `fixture is not exercising the penalty: constrained=` +
          `${withoutNative.error} unconstrained=${unconstrained.error}`,
      );
      assertAlmostEquals(
        withNative.error,
        withoutNative.error,
        1e-9,
        `enabling the native scorer changed an outputRanges score — the ` +
          `penalty was dropped (native=${withNative.error}, ` +
          `typescript=${withoutNative.error})`,
      );
    } finally {
      await Deno.remove(dataDir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "Dataset scoring parity: feedbackLoop is honoured with the native scorer enabled",
  ignore: SKIP,
  async fn() {
    await initWasmForTests();
    const cost = Costs.find("MSE");
    const dataDir = makeScoringDataDir();
    try {
      const creature = buildScoringCreature(true);
      creature.clearState();
      const withNative = await creature.evaluateDir(
        dataDir,
        cost,
        true,
        undefined,
        undefined,
        liveScorerConfig(BINARY!),
      );
      creature.clearState();
      const withoutNative = await creature.evaluateDir(
        dataDir,
        cost,
        true,
        undefined,
        undefined,
        typescriptScorerConfig(BINARY!),
      );
      creature.clearState();
      const stateless = await creature.evaluateDir(
        dataDir,
        cost,
        false,
        undefined,
        undefined,
        typescriptScorerConfig(BINARY!),
      );

      assert(
        relativeDifference(withoutNative.error, stateless.error) > 1e-9,
        `fixture is not exercising feedbackLoop: carried=` +
          `${withoutNative.error} reset=${stateless.error}`,
      );
      assertAlmostEquals(
        withNative.error,
        withoutNative.error,
        1e-9,
        `enabling the native scorer changed a feedbackLoop score — the ` +
          `native recurrent path resets state per record ` +
          `(native=${withNative.error}, typescript=${withoutNative.error})`,
      );
    } finally {
      await Deno.remove(dataDir, { recursive: true });
    }
  },
});

// ---------------------------------------------------------------------------
// Batch-mode recurrent parity (Issue #3870)
// ---------------------------------------------------------------------------

/**
 * Everything above scores one creature per invocation. Issue #3870 lets
 * recurrent creatures into a **directory-mode batch** for the first time, and
 * the failure that change can produce is not a crash: a recurrent creature
 * scored with per-record state resets where the TypeScript path carried state
 * returns a plausible but different fitness, quietly reshaping evolution.
 *
 * These cases run the real binary in batch mode over the same corpus the
 * TypeScript engine reads, and compare the numbers — the only check that
 * catches a semantics mismatch rather than a crash.
 */

/** Batch a set of creatures in one live invocation and return their errors. */
async function batchErrors(
  creatures: Creature[],
  costName: BuiltInCostName,
  dataDir: string,
): Promise<{ errors: number[]; invocations: number }> {
  const run = await tryBatchScoreWithRustScorer(
    creatures,
    dataDir,
    { ...liveScorerConfig(BINARY!), batch: true },
    costName,
  );
  const errors = creatures.map((creature) => {
    const record = run.results?.get(creature);
    assert(
      record !== undefined,
      `${costName}: the batch returned no result for a creature in the batch`,
    );
    return record.error;
  });
  return { errors, invocations: run.invocations };
}

/** The TypeScript engine's error for the same creature over the same corpus. */
async function typescriptError(
  creature: Creature,
  costName: BuiltInCostName,
  dataDir: string,
): Promise<number> {
  creature.clearState();
  const result = await creature.evaluateDir(
    dataDir,
    Costs.find(costName),
    false,
    undefined,
    undefined,
    typescriptScorerConfig(BINARY!),
  );
  return result.error;
}

/**
 * Whether the resolved binary can batch recurrent creatures at all. An older
 * one cannot, and the tests below assert the refusal instead — a silent skip
 * would read as coverage.
 */
async function recurrentBatchSupported(dataDir: string): Promise<boolean> {
  return await resolveRecurrentDirectorySupport(
    { ...liveScorerConfig(BINARY!), batch: true },
    dataDir,
  );
}

/** Register the batch-mode recurrent parity test for one cost. */
function registerRecurrentBatchParityTest(costName: BuiltInCostName): void {
  Deno.test({
    name:
      `Batch recurrent parity: rust_scorer batch and TypeScript agree for ${costName}`,
    ignore: SKIP,
    async fn() {
      await initWasmForTests();
      const dataDir = makeScoringDataDir();
      try {
        const creature = buildScoringCreature(true);
        if (!await recurrentBatchSupported(dataDir)) {
          // Pre-NEAT-AI-scorer#579 binary: it must refuse rather than return a
          // number computed under other rules, and `Fitness` keeps such
          // creatures on the per-creature path (pinned in
          // `test/architecture/FitnessForwardOnlyPartition.ts`).
          await assertRejects(
            () => batchErrors([creature], costName, dataDir),
            Error,
            undefined,
            `this binary reports no recurrent directory support, so a ` +
              `recurrent batch must fail loudly rather than score`,
          );
          return;
        }

        creature.clearState();
        const { errors: [native] } = await batchErrors(
          [creature],
          costName,
          dataDir,
        );
        const typescript = await typescriptError(creature, costName, dataDir);

        assert(
          Number.isFinite(native) && Number.isFinite(typescript),
          `${costName}: expected finite errors, got native=${native} ` +
            `typescript=${typescript}`,
        );
        const rel = relativeDifference(native, typescript);
        assert(
          rel <= PARITY_REL_TOLERANCE,
          `${costName}: a recurrent creature scored in a directory-mode ` +
            `batch disagrees with the TypeScript engine — native=${native} ` +
            `typescript=${typescript} (relative difference ${rel}, tolerance ` +
            `${PARITY_REL_TOLERANCE}). This is the silent-wrong-number risk ` +
            `Issue #3870 opened: fix the engine that moved, do not widen the ` +
            `tolerance.`,
        );
      } finally {
        await Deno.remove(dataDir, { recursive: true });
      }
    },
  });
}

for (const costName of BUILT_IN_COST_NAMES) {
  if (KNOWN_DIVERGENCES.has(costName)) continue;
  registerRecurrentBatchParityTest(costName);
}

Deno.test({
  name:
    "Batch recurrent parity: a batched recurrent creature is scored stateless, not with carried state",
  ignore: SKIP,
  async fn() {
    await initWasmForTests();
    const cost = Costs.find("MSE");
    const dataDir = makeScoringDataDir();
    try {
      const creature = buildScoringCreature(true);
      if (!await recurrentBatchSupported(dataDir)) return;

      creature.clearState();
      const { errors: [native] } = await batchErrors(
        [creature],
        "MSE",
        dataDir,
      );
      const stateless = await typescriptError(creature, "MSE", dataDir);
      creature.clearState();
      const carried = (await creature.evaluateDir(
        dataDir,
        cost,
        true,
        undefined,
        undefined,
        typescriptScorerConfig(BINARY!),
      )).error;

      // Guard: the two semantics must be far apart for this fixture, or the
      // assertion below could not tell them apart.
      assert(
        relativeDifference(carried, stateless) > 1e-3,
        `fixture cannot distinguish the two semantics: carried=${carried} ` +
          `stateless=${stateless}`,
      );
      assert(
        relativeDifference(native, stateless) <= PARITY_REL_TOLERANCE,
        `the batch scored the recurrent creature under the wrong semantics — ` +
          `native=${native}, stateless TypeScript=${stateless}, ` +
          `carried-state TypeScript=${carried}`,
      );
      assert(
        relativeDifference(native, carried) > PARITY_REL_TOLERANCE,
        `the batch appears to carry network state across records ` +
          `(native=${native}, carried-state TypeScript=${carried}). The ` +
          `native recurrent path resets per record; a run needing carried ` +
          `state must refuse with FEEDBACK_LOOP instead.`,
      );
    } finally {
      await Deno.remove(dataDir, { recursive: true });
    }
  },
});

/**
 * Weight scale that separates the two members of the mixed batch. Their errors
 * must be far apart, otherwise a result swapped between the two stems would
 * still satisfy the parity assertions and the case would prove nothing.
 */
const MIXED_BATCH_RECURRENT_SCALE = 3;

Deno.test({
  name:
    "Batch recurrent parity: a mixed batch scores every creature in one invocation",
  ignore: SKIP,
  async fn() {
    await initWasmForTests();
    const dataDir = makeScoringDataDir();
    try {
      const forwardOnly = buildScoringCreature(false);
      const recurrent = buildScoringCreature(
        true,
        MIXED_BATCH_RECURRENT_SCALE,
      );
      if (!await recurrentBatchSupported(dataDir)) {
        await assertRejects(
          () => batchErrors([forwardOnly, recurrent], "MSE", dataDir),
          Error,
          undefined,
          "a binary without recurrent directory support must refuse a mixed " +
            "batch rather than mis-score it",
        );
        return;
      }

      forwardOnly.clearState();
      recurrent.clearState();
      const { errors: [nativeForwardOnly, nativeRecurrent], invocations } =
        await batchErrors([forwardOnly, recurrent], "MSE", dataDir);
      const tsForwardOnly = await typescriptError(forwardOnly, "MSE", dataDir);
      const tsRecurrent = await typescriptError(recurrent, "MSE", dataDir);

      assertEquals(
        invocations,
        1,
        "a mixed population must cost one scorer process, not one per topology",
      );
      // Without a wide gap between the two, results swapped between the stems
      // would pass the assertions below unnoticed.
      assert(
        relativeDifference(tsForwardOnly, tsRecurrent) > 0.1,
        `the two batch members are not distinguishable: ` +
          `forwardOnly=${tsForwardOnly} recurrent=${tsRecurrent}`,
      );
      for (
        const [label, native, typescript] of [
          ["forwardOnly", nativeForwardOnly, tsForwardOnly],
          ["recurrent", nativeRecurrent, tsRecurrent],
        ] as const
      ) {
        const rel = relativeDifference(native, typescript);
        assert(
          rel <= PARITY_REL_TOLERANCE,
          `mixed batch, ${label} creature: native=${native} ` +
            `typescript=${typescript} (relative difference ${rel}). Either ` +
            `the batch mixed the two creatures' results up, or it applied one ` +
            `creature's forwardOnly flag to the other.`,
        );
      }
    } finally {
      await Deno.remove(dataDir, { recursive: true });
    }
  },
});

// ---------------------------------------------------------------------------
// Score-formula parity — the `score` field `Fitness` discards (Issue #3867)
// ---------------------------------------------------------------------------

/**
 * `rust_scorer` returns a `score` beside every `error`, and
 * `BatchScorerReconciler` validates it as a required finite field. `Fitness`
 * then reads `record.error` and throws `record.score` away, recomputing the
 * score with `Score.ts`'s `calculate` (`src/architecture/Fitness.ts:334` and
 * `:341`). Decision 4 of Issue #3863 asks whose formula should win, and until
 * now nothing anywhere compared the two numbers.
 *
 * These tests measure that gap. They feed the scorer's **own** error into the
 * TypeScript formula, so the error term cancels and what is compared is the
 * penalty arithmetic alone. That is also why RMSE is covered here despite being
 * excluded from the error sweep above: its divergence (#3853) lives in the cost
 * aggregation, not in the score formula, and cannot contaminate this reading.
 *
 * Nothing here changes which number wins — `creature.score` is still the
 * TypeScript recompute. That switch is #3863's decision to make.
 */

/**
 * Multiplier that lifts the fixture's weights and biases out of the inert
 * `magnitude <= 1` band. Every weight and bias in the default fixture is below
 * 1.0, where `valuePenalty()` returns 0 on both sides — so the default sweep
 * alone would still pass if the magnitude curve or `MAGNITUDE_COST` (#3881)
 * diverged. At this scale the magnitude term is the dominant part of the
 * complexity penalty (~2.1e-6 against ~3.9e-7 for the whole of the rest).
 */
const SCORE_FIXTURE_MAGNITUDE_SCALE = 400;

/**
 * Tolerance for the magnitude-bearing comparison. It is the one case whose
 * penalty runs through `Math.log10` on the TypeScript side and `f64::log10` on
 * the Rust side, and those may differ by an ULP across platforms. One ULP of
 * `log10` moves the score by ~1e-22 — far below the smallest formula change
 * worth catching (a single extra synapse is 1e-8 of score), so this pins the
 * equality without pinning anyone's libm. The measured difference is 0.
 */
const MAGNITUDE_SCORE_ABS_TOLERANCE = 1e-15;

/**
 * The one measured divergence, and it is not in the formula: `rust_scorer`
 * hardcodes its growth cost at `DEFAULT_COST_OF_GROWTH` and exposes no flag to
 * change it (`rust_scorer/src/cli.rs`, `const GROWTH_COST` — "CLI is KISS: no
 * flag"), while `Fitness` passes whatever `costOfGrowth` the run configured.
 * A run on a non-default growth cost therefore gets a `score` computed against
 * the wrong one. Pinned below so a scorer release that starts honouring the
 * growth cost fails here instead of passing silently.
 */
const NON_DEFAULT_GROWTH_COST = DEFAULT_COST_OF_GROWTH * 10;

/** Tolerance on the characterisation of that growth-cost divergence. */
const GROWTH_DIVERGENCE_ABS_TOLERANCE = 1e-15;

/** One score-formula measurement for a creature under one cost. */
interface ScoreFormulaMeasurement {
  /** `score` exactly as `rust_scorer` returned it — the discarded field. */
  native: number;
  /** `Score.ts` `calculate` over the scorer's own error. */
  typescript: number;
  /** The scorer's error, which both sides above were given. */
  error: number;
  /** The scorer's own `complexityPenalty`, for characterising a divergence. */
  complexityPenalty: number;
}

/**
 * Score the creature through the batch bridge — the same call `Fitness` makes —
 * and pair the scorer's `score` with the TypeScript recompute.
 *
 * @param creature - fixture creature, scored as-is.
 * @param costName - built-in cost handed to the scorer via `--cost`.
 * @param growthCost - growth cost given to the TypeScript formula. The scorer
 *   has no say in this; see {@link NON_DEFAULT_GROWTH_COST}.
 */
async function measureScoreFormula(
  creature: Creature,
  costName: BuiltInCostName,
  growthCost: number = DEFAULT_COST_OF_GROWTH,
): Promise<ScoreFormulaMeasurement> {
  await initWasmForTests();
  const dataDir = makeScoringDataDir();
  try {
    creature.clearState();
    const run = await tryBatchScoreWithRustScorer(
      [creature],
      dataDir,
      { ...liveScorerConfig(BINARY!), batch: true },
      costName,
    );
    const record = run.results?.get(creature);
    assert(
      record !== undefined,
      `${costName}: the batch scorer returned no result for the fixture ` +
        `creature, so its score field cannot be measured`,
    );
    const complexityPenalty = record.complexityPenalty;
    assert(
      typeof complexityPenalty === "number" &&
        Number.isFinite(complexityPenalty),
      `${costName}: the scorer omitted a finite complexityPenalty; got ` +
        `${JSON.stringify(complexityPenalty)}`,
    );
    return {
      native: record.score,
      typescript: calculateScore(creature, record.error, growthCost),
      error: record.error,
      complexityPenalty,
    };
  } finally {
    await Deno.remove(dataDir, { recursive: true });
  }
}

/** Register the score-formula equality test for one (cost, topology) pair. */
function registerScoreFormulaTest(
  costName: BuiltInCostName,
  selfLoop: boolean,
): void {
  const topology = selfLoop ? "recurrent" : "forwardOnly";
  Deno.test({
    name:
      `Score formula parity: rust_scorer score equals Score.ts for ${costName} (${topology})`,
    ignore: SKIP,
    async fn() {
      const { native, typescript, error } = await measureScoreFormula(
        buildScoringCreature(selfLoop),
        costName,
      );
      assert(
        Number.isFinite(native) && Number.isFinite(typescript),
        `${costName}/${topology}: expected finite scores, got ` +
          `native=${native} typescript=${typescript}`,
      );
      assertEquals(
        native,
        typescript,
        `${costName}/${topology}: the two score formulae have diverged — ` +
          `rust_scorer returned ${native}, Score.ts computed ${typescript} ` +
          `from the same error (${error}) and growth cost ` +
          `(${DEFAULT_COST_OF_GROWTH}). They agreed exactly when Issue #3867 ` +
          `measured them, which is the evidence decision 4 of #3863 rests on. ` +
          `Fix whichever formula moved, or re-measure and re-pin this ` +
          `assertion — do not relax it to a tolerance.`,
      );
    },
  });
}

for (const costName of BUILT_IN_COST_NAMES) {
  for (const selfLoop of [false, true]) {
    registerScoreFormulaTest(costName, selfLoop);
  }
}

/**
 * `test/score/MagnitudePenaltyEngineParity.ts` already proves the two engines
 * compute the same `complexityPenalty` across production magnitudes (#3881).
 * This case closes the remaining link for #3867: that the agreed penalty
 * reaches the **`score` field** identically on both sides. Without it the
 * equality above is nearly vacuous — every weight and bias in the default
 * fixture is below 1.0, where the magnitude term is identically zero.
 */
Deno.test({
  name:
    "Score formula parity: the magnitude penalty reaches the score identically",
  ignore: SKIP,
  async fn() {
    const inert = await measureScoreFormula(
      buildScoringCreature(false),
      "MSE",
    );
    const penalised = await measureScoreFormula(
      buildScoringCreature(false, SCORE_FIXTURE_MAGNITUDE_SCALE),
      "MSE",
    );

    // Without this the equality above proves nothing about the magnitude
    // curve: the default fixture's penalty is identically zero on both sides.
    assert(
      penalised.complexityPenalty > inert.complexityPenalty * 2,
      `fixture is not exercising the magnitude term: scaled penalty ` +
        `${penalised.complexityPenalty} against baseline ` +
        `${inert.complexityPenalty}`,
    );
    assertAlmostEquals(
      penalised.native,
      penalised.typescript,
      MAGNITUDE_SCORE_ABS_TOLERANCE,
      `the magnitude penalty has diverged between the engines — ` +
        `rust_scorer returned ${penalised.native}, Score.ts computed ` +
        `${penalised.typescript} from the same error ` +
        `(${penalised.error}). Issue #3881 changed this curve in both ` +
        `repositories at once; one of them has since moved alone.`,
    );
  },
});

Deno.test({
  name:
    "Score formula parity: rust_scorer ignores a non-default growth cost (known divergence)",
  ignore: SKIP,
  async fn() {
    const { native, typescript, complexityPenalty } = await measureScoreFormula(
      buildScoringCreature(false),
      "MSE",
      NON_DEFAULT_GROWTH_COST,
    );

    // Every term of the complexity penalty is linear in the growth cost, so
    // asking the TypeScript formula for 10x the growth cost must move the
    // score by exactly 9 further complexity penalties. The scorer's own score
    // does not move at all, which is the divergence.
    const divergence = native - typescript;
    const ratio = NON_DEFAULT_GROWTH_COST / DEFAULT_COST_OF_GROWTH;
    assertAlmostEquals(
      divergence,
      complexityPenalty * (ratio - 1),
      GROWTH_DIVERGENCE_ABS_TOLERANCE,
      `rust_scorer's growth-cost handling has changed. It hardcodes ` +
        `GROWTH_COST = ${DEFAULT_COST_OF_GROWTH} (rust_scorer/src/cli.rs) and ` +
        `has no flag to override it, so scoring at ` +
        `${NON_DEFAULT_GROWTH_COST} left its score untouched while Score.ts ` +
        `charged ${ratio}x the complexity penalty ` +
        `(${complexityPenalty}). Observed divergence ${divergence}. If the ` +
        `scorer now accepts a growth cost, adopting its score is no longer ` +
        `gated on this — update decision 4 of Issue #3863 and re-pin here.`,
    );
    assert(
      Math.abs(divergence) > GROWTH_DIVERGENCE_ABS_TOLERANCE,
      `expected a measurable growth-cost divergence, got ${divergence} — the ` +
        `fixture no longer carries any complexity penalty, so this test is ` +
        `not measuring anything`,
    );
  },
});
