/**
 * EvaluationScheduling.ts — cost-aware ordering for the fitness phase
 * (Issue #2934).
 *
 * The fitness phase distributes creature evaluations across a shared
 * work-stealing pull queue (`Fitness.calculate`). Each worker pulls the next
 * creature from a single front pointer as soon as it finishes its previous
 * one, so load is balanced *during* the phase. What is not balanced is the
 * **tail**: when fewer creatures remain than there are workers, some workers
 * fall idle waiting for the last (potentially expensive) evaluations to
 * finish. That idle time is exactly what the throughput metrics layer reports
 * as `fastIdleMs` / `heavyIdleMs`.
 *
 * Profiling the fitness phase (see `bench/FitnessDispatchOrdering.ts`) showed
 * the dominant idle source for cost-varied populations is this makespan tail,
 * not serialisation or the phase barrier. The classic remedy is
 * **Longest-Processing-Time-first (LPT)** scheduling: evaluate the most
 * expensive creatures first so the tail is filled with cheap ones. LPT is a
 * well-known greedy heuristic with a proven makespan bound of
 * `(4/3 - 1/(3m))` times optimal for `m` workers.
 *
 * The ordering is a pure function of creature structure, so it changes the
 * *order* of evaluation but never the *result* — every creature is still
 * scored independently. Determinism and seeded-run reproducibility are
 * preserved: ties are broken deterministically (by topology hash when
 * grouping is enabled, else by UUID).
 */
import type { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

/** Options controlling how the evaluation queue is ordered. */
export interface OrderForEvaluationOptions {
  /**
   * When true, same-topology creatures are kept contiguous (so they flow to
   * the same worker and reuse the WASM compilation cache, Issue #1862). Cost
   * ordering is applied *across* topology blocks; within a block every
   * creature has the same cost so the cache-locality grouping is preserved.
   */
  topologyGrouping: boolean;
}

/**
 * Estimates the relative fitness-evaluation cost of a creature.
 *
 * WASM activation work scales with the number of neurons evaluated and
 * synapses propagated, so `neurons + synapses` is a cheap, allocation-free
 * proxy that is constant for a given topology (same topology hash ⇒ same
 * cost). This keeps cost-aware ordering compatible with topology grouping.
 *
 * @param creature creature to estimate
 * @returns non-negative integer cost proxy
 */
export function estimateEvaluationCost(creature: Creature): number {
  return creature.neurons.length + creature.synapses.length;
}

/**
 * Orders an evaluation queue in place to minimise worker idle time.
 *
 * Primary key: estimated cost, descending (LPT). Secondary key keeps the
 * order deterministic and — when topology grouping is enabled — keeps
 * same-topology creatures contiguous. Because same-topology creatures share a
 * cost, sorting by (cost desc, hash asc) never splits a topology block, so the
 * cache-locality grouping from Issue #1862 is retained while the heaviest
 * blocks are front-loaded.
 *
 * @param queue creatures to order (mutated in place)
 * @param options ordering options
 */
export function orderForEvaluation(
  queue: Creature[],
  options: OrderForEvaluationOptions,
): void {
  if (queue.length < 2) return;

  const costCache = new Map<Creature, number>();
  const hashCache = options.topologyGrouping
    ? new Map<Creature, string>()
    : undefined;

  for (const creature of queue) {
    costCache.set(creature, estimateEvaluationCost(creature));
    if (hashCache) {
      hashCache.set(creature, CreatureUtil.getTopologyHash(creature));
    }
  }

  queue.sort((a, b) => {
    // Longest-processing-time-first: higher cost sorts earlier.
    const costDelta = costCache.get(b)! - costCache.get(a)!;
    if (costDelta !== 0) return costDelta;

    if (hashCache) {
      // Equal cost: cluster by topology hash for WASM cache locality.
      return hashCache.get(a)!.localeCompare(hashCache.get(b)!);
    }
    // Equal cost, no grouping: stable deterministic tiebreak by UUID.
    return (a.uuid ?? "").localeCompare(b.uuid ?? "");
  });
}

/**
 * Simulates the makespan of a shared work-stealing pull queue.
 *
 * Models the exact scheduling discipline of `Fitness.calculate`: workers pull
 * tasks in queue order, and each becomes free when its current task finishes.
 * Greedy list scheduling assigns each task to the earliest-free worker, which
 * is what a single shared front pointer produces. The makespan is the time the
 * last worker finishes — the wall-clock length of the fitness phase for the
 * given cost ordering.
 *
 * Used by the profiling benchmark and regression tests to compare orderings
 * without depending on noisy wall-clock timers.
 *
 * @param costs per-task cost in queue order
 * @param workers number of workers (>= 1)
 * @returns makespan in cost units (0 for an empty queue)
 */
export function simulateGreedyMakespan(
  costs: readonly number[],
  workers: number,
): number {
  if (workers <= 0 || costs.length === 0) return 0;

  // finish[i] = time at which worker i becomes free.
  const finish = new Array<number>(workers).fill(0);
  for (const cost of costs) {
    // Assign to the worker that becomes free earliest.
    let earliest = 0;
    for (let i = 1; i < workers; i++) {
      if (finish[i] < finish[earliest]) earliest = i;
    }
    finish[earliest] += Math.max(0, cost);
  }

  let makespan = 0;
  for (const f of finish) {
    if (f > makespan) makespan = f;
  }
  return makespan;
}

/**
 * Computes aggregate worker idle time for a schedule.
 *
 * Idle = total worker capacity over the makespan minus the useful work done.
 * Capacity is `workers × makespan`; useful work is the sum of task costs.
 * Mirrors `computeIdleMs` in the throughput metrics layer so benchmark numbers
 * line up with the `fastIdleMs` operators see in production.
 *
 * @param costs per-task cost in queue order
 * @param workers number of workers (>= 1)
 * @returns non-negative idle time in cost units
 */
export function computeScheduleIdle(
  costs: readonly number[],
  workers: number,
): number {
  if (workers <= 0 || costs.length === 0) return 0;
  const makespan = simulateGreedyMakespan(costs, workers);
  let useful = 0;
  for (const cost of costs) useful += Math.max(0, cost);
  const idle = workers * makespan - useful;
  return idle > 0 ? idle : 0;
}
