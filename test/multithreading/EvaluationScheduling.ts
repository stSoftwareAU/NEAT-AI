/**
 * Tests for cost-aware fitness evaluation scheduling (Issue #2934).
 *
 * The fitness phase distributes creature evaluations across a shared
 * work-stealing pull queue. With a granularity of one creature per task and
 * variable per-creature evaluation cost, the *order* creatures enter the
 * queue determines how much time workers sit idle at the end of the phase
 * (the makespan "tail"). Ordering the queue longest-cost-first (the classic
 * Longest-Processing-Time-first rule) front-loads the expensive creatures so
 * the tail is filled with cheap ones, shrinking the makespan and the idle ms
 * reported by the throughput metrics layer.
 *
 * These tests exercise the pure scheduling helpers directly with real
 * creatures and known cost distributions.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  computeScheduleIdle,
  estimateEvaluationCost,
  orderForEvaluation,
  simulateGreedyMakespan,
} from "@multithreading/EvaluationScheduling.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/** Creature with a single hidden neuron (small topology, lower cost). */
function makeSmall(bias: number): Creature {
  const data: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  };
  const c = Creature.fromJSON(data);
  CreatureUtil.makeUUID(c);
  return c;
}

/** Creature with two hidden neurons (larger topology, higher cost). */
function makeLarge(bias: number): Creature {
  const data: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias },
      { type: "hidden", uuid: "hidden-1", squash: "LOGISTIC", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.3 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  };
  const c = Creature.fromJSON(data);
  CreatureUtil.makeUUID(c);
  return c;
}

Deno.test("estimateEvaluationCost - counts neurons plus synapses", () => {
  const small = makeSmall(0.1);
  const large = makeLarge(0.2);

  assertEquals(
    estimateEvaluationCost(small),
    small.neurons.length + small.synapses.length,
  );
  // The larger topology must have a strictly higher cost so it sorts first.
  assert(
    estimateEvaluationCost(large) > estimateEvaluationCost(small),
    "Larger topology should have a higher estimated cost",
  );
});

Deno.test("orderForEvaluation - longest cost first when grouping disabled", () => {
  const small1 = makeSmall(0.1);
  const large1 = makeLarge(0.2);
  const small2 = makeSmall(0.3);

  const queue = [small1, large1, small2];
  orderForEvaluation(queue, { topologyGrouping: false });

  // The large (high-cost) creature must be evaluated first.
  assertEquals(queue[0], large1, "Highest-cost creature should be first");
  assert(
    estimateEvaluationCost(queue[0]) >= estimateEvaluationCost(queue[1]),
    "Queue must be sorted by non-increasing cost",
  );
  assert(
    estimateEvaluationCost(queue[1]) >= estimateEvaluationCost(queue[2]),
    "Queue must be sorted by non-increasing cost",
  );
});

Deno.test("orderForEvaluation - deterministic tiebreak for equal cost", () => {
  // Two equal-cost orderings must produce identical results regardless of
  // input order, so seeded runs stay reproducible.
  const a = makeSmall(0.1);
  const b = makeSmall(0.2);
  const c = makeSmall(0.3);

  const q1 = [a, b, c];
  const q2 = [c, a, b];
  orderForEvaluation(q1, { topologyGrouping: false });
  orderForEvaluation(q2, { topologyGrouping: false });

  assertEquals(
    q1.map((x) => x.uuid),
    q2.map((x) => x.uuid),
    "Equal-cost ordering must be deterministic across input permutations",
  );
});

Deno.test("orderForEvaluation - keeps same-topology contiguous when grouping enabled", () => {
  const small1 = makeSmall(0.1);
  const large1 = makeLarge(0.2);
  const small2 = makeSmall(0.3);
  const large2 = makeLarge(0.4);
  const small3 = makeSmall(0.5);

  const queue = [small1, large1, small2, large2, small3];
  orderForEvaluation(queue, { topologyGrouping: true });

  // Same topology hashes must be adjacent (cache-locality invariant).
  const hashes = queue.map((c) => CreatureUtil.getTopologyHash(c));
  const seen = new Set<string>();
  let last = "";
  for (const h of hashes) {
    if (h !== last) {
      assert(!seen.has(h), `Topology ${h} appeared non-contiguously`);
      seen.add(h);
      last = h;
    }
  }

  // The heavier topology block must come first (cost-aware front-loading).
  assertEquals(
    estimateEvaluationCost(queue[0]),
    estimateEvaluationCost(large1),
    "Heaviest topology block should lead the queue",
  );
});

Deno.test("simulateGreedyMakespan - models a shared pull queue", () => {
  // 4 workers, one heavy task last. Greedy list scheduling assigns the
  // heavy task to the earliest-free worker.
  const costs = [1, 1, 1, 1, 1, 1, 1, 10];
  assertEquals(simulateGreedyMakespan(costs, 4), 11);
  // Heavy task first shrinks the makespan tail.
  const sorted = [...costs].sort((a, b) => b - a);
  assertEquals(simulateGreedyMakespan(sorted, 4), 10);
});

Deno.test("simulateGreedyMakespan - single worker is the sum of costs", () => {
  assertEquals(simulateGreedyMakespan([2, 3, 5], 1), 10);
});

Deno.test("computeScheduleIdle - capacity minus useful work", () => {
  // makespan 11, 4 workers => capacity 44; sum of costs 17 => idle 27.
  assertEquals(computeScheduleIdle([1, 1, 1, 1, 1, 1, 1, 10], 4), 27);
});

Deno.test("orderForEvaluation - reduces idle versus insertion order", () => {
  // Representative mixed-cost population: many cheap creatures interleaved
  // with a few expensive ones (typical of a NEAT-AI generation where most
  // creatures are small and a handful have grown large topologies).
  const population: Creature[] = [];
  for (let i = 0; i < 24; i++) {
    population.push(i % 8 === 7 ? makeLarge(i * 0.01) : makeSmall(i * 0.01));
  }

  const insertionCosts = population.map(estimateEvaluationCost);

  const ordered = [...population];
  orderForEvaluation(ordered, { topologyGrouping: true });
  const orderedCosts = ordered.map(estimateEvaluationCost);

  for (const workers of [2, 4, 8]) {
    const idleBefore = computeScheduleIdle(insertionCosts, workers);
    const idleAfter = computeScheduleIdle(orderedCosts, workers);
    assert(
      idleAfter <= idleBefore,
      `Cost-aware order must not increase idle (${workers} workers: ` +
        `before=${idleBefore}, after=${idleAfter})`,
    );
  }
});
