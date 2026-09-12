/**
 * Issue #3934 — Benchmark: training-gain-log overhead per gradient step.
 *
 * The issue's failure-detection list is explicit: "instrumentation must not
 * measurably lengthen a training step; assert against a budget." So this is a
 * gate, not a table. A training event costs one descriptor of the pre-training
 * creature plus one small file append, against a step that on the GRQ lineage
 * backpropagates a 5,300-neuron creature over a 21.2 GiB corpus — minutes of
 * wall-clock per step.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi \
 *     bench/TrainingGainLogOverhead.ts
 */

import { TrainingGainLog } from "@archive/TrainingGainLog.ts";
import { resolveTrainingGainLogConfig } from "@config/TrainingGainLogConfig.ts";
import { productionScaleCreature } from "./_productionScaleCreature.ts";

const creature = productionScaleCreature(3934);
const reference = productionScaleCreature(1934);

/** Creatures a generation trains at the default 20 % of a population of 50. */
const TRAIN_PER_GEN = 10;

/** A generation's worth of distinct training candidates. */
const candidates = Array.from(
  { length: TRAIN_PER_GEN },
  (_, i) => productionScaleCreature(3934 + i + 1),
);

console.log(
  `\nIssue #3934 training-gain-log overhead — creature: ` +
    `${creature.neurons.length} neurons, ${creature.synapses.length} ` +
    `synapses; ${TRAIN_PER_GEN} training events a generation\n`,
);

const directory = await Deno.makeTempDir({ prefix: "training-gain-bench-" });
const log = new TrainingGainLog(
  resolveTrainingGainLogConfig({
    enabled: true,
    directory,
    // High enough that the per-run write bound never stops the benchmark.
    maxRecords: 1_000_000,
    runId: "bench-run",
  }),
);

/**
 * Wall-clock of one scheduled gradient step on the GRQ lineage.
 *
 * A generation of that run completes in ~7.8 minutes while training ~20 % of
 * the population, so a single step is minutes. 60,000 ms is the conservative
 * end of that range — a shorter step makes the budget below stricter, never
 * looser.
 */
const TRAINING_STEP_BUDGET_MS = 60_000;

/**
 * Share of one training step the log may cost.
 *
 * 0.1 %: the log observes a step that costs minutes, so anything the operator
 * could notice in the step's duration is the regression this gate catches.
 */
const OVERHEAD_BUDGET_FRACTION = 0.001;

/** Record one whole event: dispatch, outcome, and its append. */
async function recordEvent(
  target: typeof creature,
  rank: number,
): Promise<void> {
  log.recordDispatch(target, {
    generation: 1,
    rank,
    rankedPopulation: 50,
    scoreBefore: -0.5,
    errorBefore: 0.5,
    reference,
  });
  log.recordOutcome(target.uuid!, {
    outcome: "trained",
    scoreAfter: -0.4,
    errorAfter: 0.4,
  });
  await log.flush();
}

/**
 * Time one training event end to end and fail loudly on a breach.
 *
 * A benchmark whose numbers are only ever transcribed into a table asserts
 * nothing; this makes the budget a gate.
 */
async function assertEventWithinBudget(): Promise<void> {
  const budgetMs = TRAINING_STEP_BUDGET_MS * OVERHEAD_BUDGET_FRACTION;
  const start = performance.now();
  await recordEvent(creature, 0);
  const elapsedMs = performance.now() - start;
  const share = (elapsedMs / TRAINING_STEP_BUDGET_MS) * 100;
  console.log(
    `One training event logged: ${elapsedMs.toFixed(1)} ms ` +
      `(${share.toFixed(4)}% of a ${TRAINING_STEP_BUDGET_MS} ms step; ` +
      `budget ${budgetMs} ms)\n`,
  );
  if (elapsedMs > budgetMs) {
    throw new Error(
      `Training-gain-log overhead regressed: one event cost ` +
        `${elapsedMs.toFixed(1)} ms, over the ${budgetMs} ms budget ` +
        `(${OVERHEAD_BUDGET_FRACTION * 100}% of a training step).`,
    );
  }
}

await assertEventWithinBudget();

Deno.bench("gain log — recordDispatch, production-scale creature", () => {
  log.recordDispatch(creature, {
    generation: 1,
    rank: 0,
    rankedPopulation: 50,
    scoreBefore: -0.5,
    reference,
  });
  // Keep the pending map from growing across iterations: the dispatch is what
  // is being timed, not the outcome.
  log.abandon(creature.uuid!);
});

Deno.bench(
  "gain log — one whole event: dispatch + outcome + append",
  async () => {
    await recordEvent(creature, 0);
  },
);

Deno.bench(
  "gain log — a generation of training events (10 distinct creatures)",
  async () => {
    for (let i = 0; i < candidates.length; i++) {
      // deno-lint-ignore no-await-in-loop
      await recordEvent(candidates[i], i);
    }
  },
);
