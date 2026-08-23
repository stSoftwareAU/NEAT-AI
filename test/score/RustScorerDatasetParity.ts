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
 * When the binary cannot be resolved the lane is skipped rather than failed —
 * `quality.sh` resolves it (PATH, `--rust-scorer-bin`, sibling
 * `../NEAT-AI-scorer`) for the default run, so CI always exercises it.
 */
import { assert, assertAlmostEquals } from "@std/assert";
import { BUILT_IN_COST_NAMES, Costs } from "@costs";
import type { RequiredOutputRange } from "@config/OutputRangeConfig.ts";
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
 */
const KNOWN_DIVERGENCES: ReadonlyMap<string, string> = new Map([
  [
    "RMSE",
    "#3853 — TypeScript averages the per-record roots, Rust takes the root " +
    "of the mean",
  ],
]);

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
