/**
 * Benchmark for the fitness ranking-pass subsample (Issue #3257).
 *
 * Measures the two things the issue's merge gate cares about, on a
 * representative synthetic binary corpus (no production data required):
 *
 *  1. **Wall-clock** — how `evaluateDir` scoring time scales with
 *     `fitnessSampleRate` (1.0 → 0.5 → 0.25 → 0.1). The forward-only fused
 *     WASM path is exercised, matching the production scorer shape.
 *  2. **Quality** — the Spearman (rank) correlation between each subsample's
 *     per-creature scores and the full-corpus scores across a frozen
 *     population. This is the "does rank order survive the subsample?" signal;
 *     the issue suggests ≥ 0.95 before recommending a preset.
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-env --allow-ffi \
 *     bench/FitnessSampleRate.ts
 *
 * This is a `deno run` app (not a `Deno.bench` harness) so it is excluded from
 * `deno bench` in `deno.json`.
 *
 * Reference run (27.5 MiB synthetic corpus, population 24; Issue #3257):
 *
 *   rate    wall-clock    speedup   spearman-vs-full
 *   ------  -----------  --------  ----------------
 *    1.00      3738ms     1.02×            1.0000
 *    0.50      2104ms     1.80×            1.0000
 *    0.25      1067ms     3.56×            0.9991
 *    0.10       468ms     8.11×            1.0000
 *
 * Wall-clock falls ~proportionally to the rate; rank order (Spearman) stays
 * ≥ 0.999 — well above the suggested 0.95 preset gate — on this uniform
 * synthetic workload. Real production corpora may correlate less, so the
 * default stays 1.0 (full corpus) and enabling a sub-1 preset should be
 * confirmed against the production corpus first.
 */

import { Creature } from "@creature";
import { Costs } from "@costs";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { ensureWasmActivation } from "@wasm/EnsureWasmActivation.ts";
import { calculate as calculateScore } from "@architecture/Score.ts";

const INPUT = 32;
const OUTPUT = 4;
const RECORDS = 200_000; // ~ (32+4)*4*200k ≈ 27 MiB corpus
const POPULATION = 24;
const RATES = [1, 0.5, 0.25, 0.1];

/** Deterministic LCG so the corpus and population are reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 0xffff_ffff;
  };
}

function buildCorpus(): DataRecordInterface[] {
  const rng = lcg(3257);
  const rows: DataRecordInterface[] = new Array(RECORDS);
  for (let i = 0; i < RECORDS; i++) {
    const input = new Float32Array(INPUT);
    for (let k = 0; k < INPUT; k++) input[k] = rng() * 2 - 1;
    const output = new Float32Array(OUTPUT);
    for (let k = 0; k < OUTPUT; k++) output[k] = rng();
    rows[i] = { input, output };
  }
  return rows;
}

function buildPopulation(): Creature[] {
  const pop: Creature[] = [];
  for (let i = 0; i < POPULATION; i++) {
    const c = new Creature(INPUT, OUTPUT, {
      layers: [{ count: 16 }, { count: 8 }],
    });
    // Diversify weights so the population has a genuine score spread.
    const rng = lcg(1000 + i);
    for (const syn of c.synapses) syn.weight = rng() * 2 - 1;
    pop.push(c);
  }
  return pop;
}

/** Spearman rank correlation of two equal-length numeric arrays. */
function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]): number[] => {
    const order = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < order.length; i++) r[order[i][1]] = i;
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const mean = (n - 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i] - mean;
    const y = rb[i] - mean;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da === 0 || db === 0 ? 1 : num / Math.sqrt(da * db);
}

async function scorePopulation(
  pop: Creature[],
  dir: string,
  rate: number,
): Promise<{ scores: number[]; ms: number }> {
  const cost = Costs.find("MSE");
  const scores: number[] = [];
  const start = performance.now();
  for (const c of pop) {
    // deno-lint-ignore no-await-in-loop -- sequential scoring is the measured workload.
    const { error } = await c.evaluateDir(
      dir,
      cost,
      false,
      undefined,
      undefined,
      undefined,
      rate,
    );
    // Same fitness transform the evolution loop applies, so the ranking we
    // correlate is the one selection would actually see.
    scores.push(calculateScore(c, error, 0.000_000_1));
  }
  return { scores, ms: performance.now() - start };
}

async function main() {
  await ensureWasmActivation();
  console.log(
    `Corpus: ${RECORDS.toLocaleString()} records × ${INPUT}in/${OUTPUT}out ` +
      `(${((RECORDS * (INPUT + OUTPUT) * 4) / 1024 / 1024).toFixed(1)} MiB); ` +
      `population ${POPULATION}`,
  );

  const dir = makeDataDir(buildCorpus(), RECORDS);
  try {
    const pop = buildPopulation();
    // Warm the WASM compilation cache so the first rate is not penalised.
    await scorePopulation(pop, dir, 1);

    const baseline = await scorePopulation(pop, dir, 1);
    console.log("\nrate    wall-clock    speedup   spearman-vs-full");
    console.log("------  -----------  --------  ----------------");
    for (const rate of RATES) {
      // deno-lint-ignore no-await-in-loop -- rates are measured one at a time.
      const run = await scorePopulation(pop, dir, rate);
      const speedup = baseline.ms / run.ms;
      const rho = spearman(run.scores, baseline.scores);
      console.log(
        `${rate.toFixed(2).padStart(5)}  ${
          `${run.ms.toFixed(0)}ms`.padStart(10)
        }  ${`${speedup.toFixed(2)}×`.padStart(8)}  ${
          rho.toFixed(4).padStart(16)
        }`,
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

if (import.meta.main) {
  await main();
}
