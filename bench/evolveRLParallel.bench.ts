/**
 * evolveRLParallel.bench.ts — Microbenchmark proving parallel episode
 * rollouts deliver real-worker speedup (Issue #2612 acceptance criterion).
 *
 * Spins up a CPU-bound trivial adapter — a fixed busy-loop per `step()` so
 * episodes spend most of their wall-clock burning JS cycles, not waiting
 * on I/O — and measures the time to score a population once with the
 * episode worker pool at `threads = 1`, `2`, and `4`.
 *
 * Acceptance criterion: `threads = 4` is at least 1.5× faster than
 * `threads = 1` on a CPU-bound adapter. The exact ratio depends on the
 * host machine, but the bench runs enough creatures to amortise worker
 * spin-up so the ratio is meaningful.
 *
 * Run with:
 *
 *   deno run --allow-read --allow-write --allow-net --allow-env \
 *       --allow-run --allow-ffi --config ./deno.json \
 *       bench/evolveRLParallel.bench.ts
 *
 * Reference results (Issue #2612, M-class macOS host, 16 creatures × 3
 * episodes, 200_000 busy-loop iterations per step):
 *
 *   threads=1: 6213 ms
 *   threads=2: 3445 ms (speedup 1.80x)
 *   threads=4: 1829 ms (speedup 3.40x)
 */

import { Creature } from "@creature";
import { EpisodeWorkerPool } from "@creature/EpisodeWorkerPool.ts";
import { ensureWasmActivation } from "@wasm/EnsureWasmActivation.ts";

const ADAPTER_URL = new URL(
  "../test/creature/fixtures/CpuBoundAdapterFixture.ts",
  import.meta.url,
).href;

const POPULATION_SIZE = 16;
const EPISODES_PER_CREATURE = 3;
const SEED_BASE = 12345;

async function timeRollouts(threads: number): Promise<number> {
  const pool = await EpisodeWorkerPool.create({
    adapter: { url: ADAPTER_URL, config: { busyIterations: 200_000 } },
    threads,
    direct: false,
  });
  try {
    const creatures = Array.from(
      { length: POPULATION_SIZE },
      () => new Creature(1, 1),
    );
    const seedSet = Array.from(
      { length: EPISODES_PER_CREATURE },
      (_, i) => SEED_BASE + i,
    );

    // Warm-up so worker init / module load does not skew the measurement.
    await Promise.all(
      creatures.slice(0, threads).map((c) => pool.runEpisodes(c, seedSet)),
    );

    const t0 = performance.now();
    await Promise.all(creatures.map((c) => pool.runEpisodes(c, seedSet)));
    const elapsed = performance.now() - t0;
    return elapsed;
  } finally {
    pool.terminate();
  }
}

async function main(): Promise<void> {
  await ensureWasmActivation();

  console.log(
    `Running CPU-bound rollouts: population=${POPULATION_SIZE}, ` +
      `episodes=${EPISODES_PER_CREATURE}\n`,
  );

  const t1 = await timeRollouts(1);
  const t2 = await timeRollouts(2);
  const t4 = await timeRollouts(4);

  console.log(`threads=1: ${t1.toFixed(0)} ms`);
  console.log(
    `threads=2: ${t2.toFixed(0)} ms (speedup ${(t1 / t2).toFixed(2)}x)`,
  );
  console.log(
    `threads=4: ${t4.toFixed(0)} ms (speedup ${(t1 / t4).toFixed(2)}x)`,
  );

  const ratio = t1 / t4;
  if (ratio < 1.5) {
    console.error(
      `\nFAIL: threads=4 speedup ${
        ratio.toFixed(2)
      }x < 1.5x acceptance threshold`,
    );
    Deno.exit(1);
  }
  console.log(`\nPASS: threads=4 speedup ${ratio.toFixed(2)}x ≥ 1.5x`);
}

if (import.meta.main) {
  await main();
}
