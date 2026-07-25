/**
 * Benchmark: peak heap of a per-generation checkpoint write (Issue #3436).
 *
 * Before #3436 `writeCreatures` exported and stringified **every** population
 * member up front and then `Promise.all`-ed the writes, so peak heap grew as
 * `populationSize × genome JSON`. After #3436 creatures are exported,
 * stringified, and written in bounded batches, so at most `batchSize` genome
 * JSON strings are alive at once.
 *
 * Methodology (mirrors bench/DiscoveryAnalysisCacheRelease.ts):
 *   - The orchestrator spawns one fresh `deno run` subprocess per
 *     (mode, scenario) so each measurement starts from an empty heap.
 *   - `promise-all` replicates the pre-#3436 code verbatim; `batched` calls
 *     the shipped `writeCreatures`.
 *   - Both modes sample `Deno.memoryUsage()` at the same point — immediately
 *     before each file write — plus once at the end.
 *   - Median of 3 runs per (mode, scenario) damps GC timing noise.
 *
 * Run:
 *   deno run --allow-all bench/CheckpointWritePeakHeap.ts
 */

import { emptyDirSync } from "@std/fs";
import { Creature } from "@creature";
import {
  type CheckpointSource,
  writeCreatures,
} from "@creature/CheckpointWriter.ts";
import { applySeedWarmupTagsAtSave } from "@architecture/CreatureFactory.ts";

const MB = 1024 * 1024;

type Mode = "promise-all" | "batched";

interface SampleStats {
  mode: Mode;
  populationSize: number;
  peakUsedMB: number;
  peakRssMB: number;
  bytesWritten: number;
}

// =============================================================================
// Child-process worker
// =============================================================================

function buildPopulation(size: number): Creature[] {
  const population: Creature[] = [];
  for (let i = 0; i < size; i++) {
    const creature = new Creature(20, 5, {
      layers: [{ count: 80 }, { count: 80 }],
    });
    creature.score = i;
    population.push(creature);
  }
  return population;
}

/** Children run with `--expose-gc` so samples measure the LIVE set. */
const forceGc = (globalThis as { gc?: () => void }).gc;

/**
 * Samples peak **live** heap: without a forced collection `heapUsed` counts
 * released-but-uncollected strings, which hides the very difference under
 * test. Sampling every `SAMPLE_EVERY` writes (identical points in both
 * modes) keeps the GC cost tolerable.
 */
const SAMPLE_EVERY = 8;

function peakSampler() {
  let peakUsed = 0;
  let peakRss = 0;
  let writeIndex = 0;

  const sample = () => {
    forceGc?.();
    const m = Deno.memoryUsage();
    if (m.heapUsed > peakUsed) peakUsed = m.heapUsed;
    if (m.rss > peakRss) peakRss = m.rss;
  };

  return {
    /** Called immediately before each file write. */
    observe() {
      if (writeIndex % SAMPLE_EVERY === 0) sample();
      writeIndex++;
    },
    sample,
    peakUsedMB: () => peakUsed / MB,
    peakRssMB: () => peakRss / MB,
  };
}

/** Pre-#3436 implementation: stringify the whole population, then Promise.all. */
async function writeCreaturesPromiseAll(
  source: CheckpointSource,
  dir: string,
  sampler: ReturnType<typeof peakSampler>,
): Promise<void> {
  emptyDirSync(dir);
  const writes: Promise<void>[] = [];
  let counter = 1;
  for (const creature of source.population) {
    const json = creature.exportJSON();
    applySeedWarmupTagsAtSave(
      json,
      source.warmupGenerations,
      source.currentGeneration,
    );
    const txt = JSON.stringify(json);
    sampler.observe();
    writes.push(Deno.writeTextFile(`${dir}/${counter}.json`, txt));
    counter++;
  }
  await Promise.all(writes);
  sampler.sample();
}

async function runChild(
  mode: Mode,
  populationSize: number,
): Promise<SampleStats> {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_heap_" });
  const sampler = peakSampler();
  const population = buildPopulation(populationSize);
  const source: CheckpointSource = {
    population,
    warmupGenerations: 0,
    currentGeneration: 0,
  };

  try {
    if (mode === "promise-all") {
      await writeCreaturesPromiseAll(source, dir, sampler);
    } else {
      await writeCreatures(source, dir, {
        writeTextFile: (path, text) => {
          sampler.observe();
          return Deno.writeTextFile(path, text);
        },
      });
      sampler.sample();
    }

    const entries = await Array.fromAsync(Deno.readDir(dir));
    const sizes = await Promise.all(
      entries.map((entry) => Deno.stat(`${dir}/${entry.name}`)),
    );
    const bytesWritten = sizes.reduce((total, stat) => total + stat.size, 0);

    return {
      mode,
      populationSize,
      peakUsedMB: sampler.peakUsedMB(),
      peakRssMB: sampler.peakRssMB(),
      bytesWritten,
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

// =============================================================================
// Orchestration
// =============================================================================

const SCENARIOS = [16, 54, 128, 256];

function pct(before: number, after: number): string {
  if (before === 0) return "n/a";
  return `${(100 * (before - after) / before).toFixed(1)}%`;
}

async function spawnChild(
  mode: Mode,
  populationSize: number,
): Promise<SampleStats> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-all",
      "--v8-flags=--expose-gc",
      new URL(import.meta.url).pathname,
      "--child",
      mode,
      String(populationSize),
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout, stderr, code } = await cmd.output();
  if (code !== 0) {
    throw new Error(
      `child exited ${code}: ${new TextDecoder().decode(stderr)}`,
    );
  }
  const out = new TextDecoder().decode(stdout).trim();
  const line = out.split("\n").find((l) => l.startsWith("{"));
  if (!line) throw new Error(`no JSON output from child:\n${out}`);
  return JSON.parse(line) as SampleStats;
}

const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
  console.log("Checkpoint write peak heap — Issue #3436");
  console.log("  promise-all = pre-#3436 (whole population stringified first)");
  console.log("  batched     = post-#3436 (bounded batches of 8)");
  console.log("  Each measurement runs in a fresh subprocess.\n");

  for (const populationSize of SCENARIOS) {
    const before: SampleStats[] = [];
    const after: SampleStats[] = [];
    for (let i = 0; i < 3; i++) {
      // Sequential — parallel children would contend for physical memory.
      // deno-lint-ignore no-await-in-loop
      before.push(await spawnChild("promise-all", populationSize));
      // deno-lint-ignore no-await-in-loop
      after.push(await spawnChild("batched", populationSize));
    }

    const beforePeak = median(before.map((r) => r.peakUsedMB));
    const afterPeak = median(after.map((r) => r.peakUsedMB));
    const beforeRss = median(before.map((r) => r.peakRssMB));
    const afterRss = median(after.map((r) => r.peakRssMB));

    console.log(`\n=== population ${populationSize} (median of 3) ===`);
    console.log(
      `  peak heapUsed: promise-all=${beforePeak.toFixed(1)}MB  batched=${
        afterPeak.toFixed(1)
      }MB  (reduction ${pct(beforePeak, afterPeak)})`,
    );
    console.log(
      `  peak rss:      promise-all=${beforeRss.toFixed(1)}MB  batched=${
        afterRss.toFixed(1)
      }MB  (saved ${(beforeRss - afterRss).toFixed(1)}MB, ${
        pct(beforeRss, afterRss)
      })`,
    );
    console.log(
      `  bytes written: promise-all=${before[0].bytesWritten}  batched=${
        after[0].bytesWritten
      }  (delta ${after[0].bytesWritten - before[0].bytesWritten})`,
    );
  }
}

// =============================================================================
// Entry point
// =============================================================================

if (Deno.args[0] === "--child") {
  // Fail loud: without --expose-gc the samples would count uncollected
  // garbage and silently understate the difference under test.
  if (!forceGc) {
    throw new Error(
      "child requires --v8-flags=--expose-gc for live-heap sampling",
    );
  }
  const stats = await runChild(Deno.args[1] as Mode, Number(Deno.args[2]));
  console.log(JSON.stringify(stats));
} else {
  await main();
}
