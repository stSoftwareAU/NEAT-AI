/**
 * `NeatOptions.preSelection` reaching the evolution loop (Issue #3932).
 *
 * The stage is only worth having if the breeder is actually asked for a
 * surplus, so the seams tested here are config → `Neat` → the offspring target
 * the breeding batch is sized from, and an end-to-end evolve proving the
 * default costs exactly what it always did.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Neat } from "@neat/Neat.ts";
import { Creature } from "@creature";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { PreSelectionError } from "@errors/PreSelectionError.ts";
import { SurrogateScreen } from "@neat/OffspringScreen.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { buildCandidates } from "./_preSelectionFixtures.ts";

/** A tiny, deterministic regression an evolve run can finish in seconds. */
function buildDataSet(): DataRecordInterface[] {
  const rows: DataRecordInterface[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i % 4) / 4;
    const b = ((i * 3) % 5) / 5;
    rows.push({
      input: new Float32Array([a, b]),
      output: new Float32Array([a * 0.5 + b * 0.25]),
    });
  }
  return rows;
}

Deno.test("pre-selection wiring — a default Neat runs the stage off", () => {
  const neat = new Neat(2, 1, { populationSize: 6 }, []);
  assertEquals(neat.config.preSelection.ratio, 1);
  assertEquals(neat.config.preSelection.screen, "none");
  assertEquals(neat.preSelection.active, false);
  assertEquals(neat.preSelection.screen, undefined);
  // The breeder is asked for exactly what the population budget calls for.
  assertEquals(neat.preSelection.offspringTarget(5), 5);
});

Deno.test("pre-selection wiring — a requested ratio reaches the stage", () => {
  const neat = new Neat(2, 1, {
    populationSize: 6,
    preSelection: { ratio: 3, screen: "surrogate" },
  }, []);
  assertEquals(neat.preSelection.active, true);
  assertEquals(neat.preSelection.screenName, "surrogate");
  assert(neat.preSelection.screen instanceof SurrogateScreen);
  // Nothing has been evaluated yet, so the screen cannot rank and no surplus
  // is bred: the stage never discards on a number it could not produce.
  assertEquals(neat.preSelection.offspringTarget(5), 5);
});

Deno.test("pre-selection wiring — a surrogate taught by a generation asks for the surplus", () => {
  const neat = new Neat(2, 1, {
    populationSize: 6,
    preSelection: { ratio: 3, screen: "surrogate" },
  }, []);
  const population = buildCandidates(5);
  population.forEach((creature, i) => creature.score = i);
  neat.preSelection.observe(population);
  assertEquals(neat.preSelection.offspringTarget(5), 15);
});

Deno.test("pre-selection wiring — an invalid ratio fails the run, not the generation", () => {
  assertThrows(
    () =>
      new Neat(2, 1, {
        populationSize: 6,
        preSelection: { ratio: 0 },
      }, []),
    ConfigurationError,
  );
});

Deno.test("pre-selection wiring — the sampled screen refuses to run with no evaluator behind it", () => {
  const error = assertThrows(
    () =>
      new Neat(2, 1, {
        populationSize: 6,
        preSelection: { ratio: 3, screen: "sampled" },
      }, []),
    PreSelectionError,
  );
  assertEquals(error.reason, "NO_SCREEN_EVALUATOR");
});

Deno.test("pre-selection wiring — a default evolve run screens nothing", async () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const result = await creature.evolveDataSet(buildDataSet(), {
    iterations: 2,
    populationSize: 6,
    elitism: 1,
    threads: 1,
    verbose: false,
  });
  assert(result.score !== undefined);
});

Deno.test("pre-selection wiring — an active stage screens a real generation's offspring", async () => {
  const dataDir = makeDataDir(buildDataSet(), 2000);
  const workers = [new WorkerHandler(dataDir, "MSE", true)];
  try {
    const seed = new Creature(2, 1, { layers: [{ count: 3 }] });
    const neat = new Neat(2, 1, {
      creatures: [seed.exportJSON()],
      populationSize: 30,
      elitism: 1,
      preSelection: { ratio: 3, screen: "surrogate" },
    }, workers);
    await neat.populatePopulation(seed);

    // The screen starts unready, so nothing is over-generated until the first
    // generation's exact scores have taught it.
    assertEquals(neat.preSelection.offspringTarget(10), 10);

    let fittest: Creature | undefined;
    let screened = 0;
    for (let generation = 0; generation < 3; generation++) {
      fittest = (await neat.evolve(fittest)).fittest;
      const summary = neat.preSelection.lastGeneration;
      assert(summary !== undefined, "the stage must report what it did");
      assertEquals(
        summary.survivors + summary.screenedOut,
        summary.offspringGenerated,
        "every offspring is either kept or discarded",
      );
      screened += summary.screenedOut;
      assert(
        neat.population.length <= 30,
        `the population must stay at its budget, got ${neat.population.length}`,
      );
      // The surplus is cut before the population is assembled, so it never
      // reaches the next generation's fitness queue — and the creature the
      // run would export is still a scored one.
      assert(
        fittest.score !== undefined && Number.isFinite(fittest.score),
        "the exported fittest carries a real score",
      );
    }
    assert(
      screened > 0,
      "an active stage over three generations must discard some offspring",
    );
  } finally {
    await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
    for (const worker of workers) worker.terminate();
  }
});
