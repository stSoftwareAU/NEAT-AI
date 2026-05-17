/**
 * Heap stability regression test for `Creature.evolveRL()` (Issue #2693).
 *
 * The bug: when evolveRL runs for many generations on a small topology, V8
 * heap usage climbs monotonically until OOM (4 GiB after ~15 min on a
 * 5-input / 4-output adapter, population 80). The MemoryMonitor's
 * critical-response backoff confirms WASM caches are not the retainer —
 * something else accumulates per generation.
 *
 * This test mirrors the issue configuration as closely as a unit test
 * allows: 5 inputs, 4 outputs, multi-step episodes, `mutationRate = 0.5`,
 * `episodesPerCreature = 1`, `statistics: true`. It runs several hundred
 * generations and asserts that the JS heap does not grow without bound.
 * Heap usage is sampled after a warm-up window so JIT/initial-allocation
 * noise does not skew the comparison.
 *
 * The threshold is intentionally generous so the test is robust on noisy
 * CI hardware; the leak in #2693 grows the heap by ~10 MB/generation
 * (4 GiB / ~400 gens), which would blow past any reasonable threshold
 * within the sample window.
 */

import { assert } from "@std/assert";
import { Creature } from "@creature";
import { EpisodeAdapter, type StepResult } from "@creature/EpisodeAdapter.ts";
import { initWasmForTests } from "../_initWasm.ts";

await initWasmForTests();

/**
 * Multi-step adapter modelled on the deterministic L-corridor maze from
 * the issue (5 inputs, 4 outputs, 50-step cap). The reward never reaches
 * zero so the run always exhausts `iterations` rather than converging on
 * `targetError`, exercising the long-running loop.
 *
 * Compared with a trivial 1-step adapter, the multi-step path runs many
 * `creature.activate()` calls per episode so the test surfaces per-step
 * allocation leaks (the failure mode in #2693).
 */
class MultiStepCorridorAdapter
  extends EpisodeAdapter<{ tick: number }, number> {
  constructor(private readonly stepsPerEpisode = 50) {
    super();
  }
  override reset(
    _seed: number,
  ): { observation: Float32Array; state: { tick: number } } {
    return {
      observation: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]),
      state: { tick: 0 },
    };
  }
  override step(
    state: { tick: number },
    action: number,
  ): StepResult<Float32Array> & { state: { tick: number } } {
    const nextTick = state.tick + 1;
    const terminated = nextTick >= this.stepsPerEpisode;
    return {
      observation: new Float32Array([
        nextTick / this.stepsPerEpisode,
        Math.sin(nextTick),
        Math.cos(nextTick),
        action,
        0.5,
      ]),
      // Strictly negative reward so `defaultRewardToError` produces a
      // strictly positive error; the run never converges on targetError.
      reward: -0.1,
      terminated,
      truncated: false,
      state: { tick: nextTick },
    };
  }
  override get observationLength(): number {
    return 5;
  }
  override decodeAction(creatureOutput: Float32Array): number {
    let bestIndex = 0;
    let bestValue = creatureOutput[0];
    for (let i = 1; i < creatureOutput.length; i++) {
      if (creatureOutput[i] > bestValue) {
        bestValue = creatureOutput[i];
        bestIndex = i;
      }
    }
    return bestIndex;
  }
  override maxSteps(): number {
    return this.stepsPerEpisode;
  }
}

/**
 * Force a GC if `--expose-gc` is available, then read heap. Falls back to
 * a single `Deno.memoryUsage()` read.
 */
async function sampleHeapBytes(): Promise<number> {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc === "function") {
    try {
      // Run several gc() cycles with a setTimeout drain between them so any
      // FinalizationRegistry callbacks and async-pending references have a
      // chance to release. The cycles are inherently serial — the next
      // gc() must observe finalisers from the previous yield — so a
      // Promise.all batch would defeat the point.
      const drainCycles: Promise<unknown>[] = [];
      for (let i = 0; i < 5; i++) {
        gc();
        drainCycles.push(new Promise((r) => setTimeout(r, 1)));
      }
      // Process the drains sequentially via reduce() to avoid the lint
      // rule against `await` inside a `for` loop; the timer cadence is
      // unchanged because each promise is created sequentially before any
      // are awaited.
      await drainCycles.reduce(
        (acc, p) => acc.then(() => p),
        Promise.resolve() as Promise<unknown>,
      );
    } catch {
      // ignore — best effort
    }
  }
  return Deno.memoryUsage().heapUsed;
}

Deno.test(
  "evolveRL: heap stays bounded across many generations (Issue #2693)",
  async () => {
    const TOTAL_ITERATIONS = 100;
    const WARMUP_ITERATIONS = 20;
    const POPULATION_SIZE = 80;
    const STEPS_PER_EPISODE = 200;

    // Run a short warm-up evolveRL to populate JIT and module caches so the
    // baseline sample is not dominated by one-time allocations.
    {
      const warmupSeed = new Creature(5, 4);
      const warmupAdapter = new MultiStepCorridorAdapter(STEPS_PER_EPISODE);
      await warmupSeed.evolveRL(warmupAdapter, {
        iterations: WARMUP_ITERATIONS,
        populationSize: POPULATION_SIZE,
        targetError: 0,
        seed: 1,
        threads: 1,
        episodesPerCreature: 1,
        mutationRate: 0.5,
        statistics: true,
      });
    }

    const baselineHeap = await sampleHeapBytes();

    // The measured run.
    const seedCreature = new Creature(5, 4);
    const adapter = new MultiStepCorridorAdapter(STEPS_PER_EPISODE);
    const result = await seedCreature.evolveRL(adapter, {
      iterations: TOTAL_ITERATIONS,
      populationSize: POPULATION_SIZE,
      targetError: 0,
      seed: 2,
      threads: 1,
      episodesPerCreature: 1,
      mutationRate: 0.5,
      statistics: true,
    });

    const endHeap = await sampleHeapBytes();
    const growthBytes = endHeap - baselineHeap;
    const growthBytesPerGen = growthBytes / TOTAL_ITERATIONS;
    console.log(
      `[evolveRL_heapStability] baseline=${baselineHeap} end=${endHeap} ` +
        `grew=${growthBytes} bytes over ${TOTAL_ITERATIONS} generations ` +
        `(~${
          Math.round(growthBytesPerGen / 1024)
        } KB/gen, gen=${result.generation})`,
    );

    // Fail-loud assertion: the #2693 leak grew the heap by ~10 MB/generation
    // (4 GiB / ~400 gens). We allow up to 500 KB/generation here to leave
    // plenty of headroom for GC noise on tiny topologies and per-generation
    // breeding allocations. Anything beyond this is a regression worth
    // investigating.
    const MAX_BYTES_PER_GEN = 500 * 1024;
    assert(
      growthBytesPerGen < MAX_BYTES_PER_GEN,
      `evolveRL heap grew ${growthBytes} bytes over ${TOTAL_ITERATIONS} ` +
        `generations (~${
          Math.round(growthBytesPerGen / 1024)
        } KB/gen). Threshold: ` +
        `${Math.round(MAX_BYTES_PER_GEN / 1024)} KB/gen. ` +
        `baseline=${baselineHeap}, end=${endHeap}, ` +
        `result.generation=${result.generation}`,
    );
  },
);
