/**
 * Profiling benchmark for fitness-phase worker idle time (Issue #2934).
 *
 * The fitness phase distributes creature evaluations across a shared
 * work-stealing pull queue. With one creature per task and variable
 * per-creature cost, the dominant idle source is the makespan *tail*: near the
 * end of the phase fewer creatures remain than there are workers, so workers
 * fall idle waiting for the last (possibly expensive) evaluations. This is the
 * `fastIdleMs` / `heavyIdleMs` the throughput metrics layer reports.
 *
 * This benchmark profiles that tail deterministically — without noisy
 * wall-clock timers — by simulating the exact pull-queue scheduling discipline
 * for two orderings of the same representative population:
 *
 *   - "insertion": the order creatures arrive (baseline, cost-agnostic).
 *   - "cost-aware": longest-processing-time-first (the Issue #2934 change).
 *
 * It reports makespan and idle (in cost units) for each ordering across a
 * range of worker counts, and the percentage idle reduction. Because the
 * scheduling model and the ordering helper are the same code paths the
 * production fitness phase uses, the relative numbers transfer directly to the
 * `fastIdleMs` operators see in production.
 *
 * Run as a report (prints the before/after table):
 *   deno run --allow-read bench/FitnessDispatchOrdering.ts
 *
 * Run the micro-benchmark of the ordering helper:
 *   deno bench bench/FitnessDispatchOrdering.ts
 */
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  computeScheduleIdle,
  estimateEvaluationCost,
  orderForEvaluation,
  simulateGreedyMakespan,
} from "@multithreading/EvaluationScheduling.ts";

/** Build a creature with `hidden` hidden neurons in a feed-forward chain. */
function makeCreature(hidden: number, bias: number): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  for (let i = 0; i < hidden; i++) {
    neurons.push({
      type: "hidden",
      uuid: `hidden-${i}`,
      squash: "TANH",
      bias: bias + i * 0.001,
    });
    const from = i === 0 ? "input-0" : `hidden-${i - 1}`;
    synapses.push({ fromUUID: from, toUUID: `hidden-${i}`, weight: 0.5 });
  }
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0.1,
  });
  synapses.push({
    fromUUID: hidden > 0 ? `hidden-${hidden - 1}` : "input-0",
    toUUID: "output-0",
    weight: 0.8,
  });
  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: 2,
    output: 1,
  });
  CreatureUtil.makeUUID(creature);
  return creature;
}

/**
 * A representative NEAT-AI generation: mostly small creatures with a long tail
 * of progressively larger topologies — the shape that produces the worst
 * makespan tail. Sizes are deterministic so the report is reproducible.
 */
function representativePopulation(size: number): Creature[] {
  const population: Creature[] = [];
  for (let i = 0; i < size; i++) {
    // ~80% small (1 hidden), ~15% medium (4 hidden), ~5% large (16 hidden).
    let hidden = 1;
    if (i % 20 === 19) hidden = 16;
    else if (i % 20 >= 17) hidden = 4;
    population.push(makeCreature(hidden, 0.1 + i * 0.0001));
  }
  return population;
}

if (import.meta.main) {
  const population = representativePopulation(100);
  const insertionCosts = population.map(estimateEvaluationCost);

  const ordered = [...population];
  orderForEvaluation(ordered, { topologyGrouping: true });
  const orderedCosts = ordered.map(estimateEvaluationCost);

  const totalCost = insertionCosts.reduce((a, b) => a + b, 0);
  console.log(
    `\nFitness dispatch ordering — Issue #2934\n` +
      `Population: ${population.length} creatures, total cost ${totalCost}\n`,
  );
  console.log(
    "workers | makespan(before) | makespan(after) | " +
      "idle(before) | idle(after) | idle reduction",
  );
  console.log(
    "------- | ---------------- | --------------- | " +
      "------------ | ----------- | --------------",
  );
  for (const workers of [2, 4, 8, 16]) {
    const mkBefore = simulateGreedyMakespan(insertionCosts, workers);
    const mkAfter = simulateGreedyMakespan(orderedCosts, workers);
    const idleBefore = computeScheduleIdle(insertionCosts, workers);
    const idleAfter = computeScheduleIdle(orderedCosts, workers);
    const reduction = idleBefore > 0
      ? ((100 * (idleBefore - idleAfter)) / idleBefore).toFixed(1)
      : "0.0";
    console.log(
      `${String(workers).padStart(7)} | ${String(mkBefore).padStart(16)} | ` +
        `${String(mkAfter).padStart(15)} | ${
          String(idleBefore).padStart(12)
        } | ` +
        `${String(idleAfter).padStart(11)} | ${reduction.padStart(12)}%`,
    );
  }
  console.log("");
}

// Micro-benchmark: the cost of computing the ordering itself must stay cheap
// relative to the multi-millisecond evaluation phase it optimises.
Deno.bench({
  name: "orderForEvaluation - 100 creatures (grouping on)",
  fn() {
    const queue = representativePopulation(100);
    orderForEvaluation(queue, { topologyGrouping: true });
  },
});
