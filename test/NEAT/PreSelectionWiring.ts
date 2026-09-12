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
import type { PreSelectionSummary } from "@neat/PreSelection.ts";
import { EVALUATION_ARCHIVE_FILE_NAME } from "@config/EvaluationArchiveConfig.ts";
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

/**
 * The hard cap on generations {@link evolveUntilScreened} will run.
 *
 * A generation only discards when the breeder answers the surplus request
 * with more offspring than the population budget calls for, and the breeder
 * builds only as many distinct offspring as the population it has can yield —
 * a small, low-diversity population honestly offers no surplus to cut. A
 * fixed generation count is therefore a bet on that yield; the cap is the
 * point at which the yield is so poor that the run has nothing left to prove.
 */
const MAX_SCREENING_GENERATIONS = 15;

/** What a run driven by {@link evolveUntilScreened} produced. */
interface ScreenedRun {
  /** The creature the run would export. */
  readonly fittest: Creature;
  /** Generations actually evolved. */
  readonly generations: number;
  /** Offspring the stage discarded across the whole run. */
  readonly screenedOut: number;
}

/** Hooks a caller runs around each generation. */
interface ScreenedRunHooks {
  /** Run before a generation evolves, with the population it starts with. */
  readonly before?: (population: readonly Creature[]) => void;
  /** Run after a generation evolves, with what the stage reported. */
  readonly after?: (summary: PreSelectionSummary, fittest: Creature) => void;
  /**
   * Stop as soon as this is true, instead of one generation after the first
   * discard. A caller waiting on a diagnostic that depends on *which*
   * creatures became elites cannot know in advance which generation produces
   * it, so it states the condition rather than a generation count.
   */
  readonly until?: () => boolean;
}

/**
 * Evolve until the stage has actually discarded something, then one
 * generation more — or until `hooks.until` says so.
 *
 * The extra generation is not padding: a screened survivor's prediction is
 * differenced against the exact score that arrives for it in the *following*
 * generation, so stopping on the first screened generation leaves every
 * residual outstanding.
 *
 * @param neat - The configured run, already populated.
 * @param hooks - Per-generation assertions the caller wants to make.
 * @returns What the run produced.
 * @throws {AssertionError} When the cap is reached with nothing discarded —
 *   a run that proved nothing fails loudly rather than passing quietly.
 */
async function evolveUntilScreened(
  neat: Neat,
  hooks: ScreenedRunHooks = {},
): Promise<ScreenedRun> {
  let fittest: Creature | undefined;
  let screenedOut = 0;
  let generations = 0;
  let sinceFirstScreen = 0;
  while (generations < MAX_SCREENING_GENERATIONS) {
    hooks.before?.(neat.population);
    // Generations are sequential by definition: each one breeds from the
    // population the one before it produced.
    // deno-lint-ignore no-await-in-loop
    fittest = (await neat.evolve(fittest)).fittest;
    generations++;
    const summary = neat.preSelection.lastGeneration;
    assert(summary !== undefined, "the stage must report what it did");
    hooks.after?.(summary, fittest);
    screenedOut += summary.screenedOut;
    if (hooks.until !== undefined) {
      if (hooks.until()) break;
      continue;
    }
    if (screenedOut > 0 && ++sinceFirstScreen > 1) break;
  }
  assert(
    fittest !== undefined && screenedOut > 0,
    `the stage discarded nothing over ${generations} generation(s): the ` +
      `breeder never answered the surplus request with more offspring than ` +
      `the budget called for`,
  );
  return { fittest, generations, screenedOut };
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

    await evolveUntilScreened(neat, {
      after: (summary, fittest) => {
        assertEquals(
          summary.survivors + summary.screenedOut,
          summary.offspringGenerated,
          "every offspring is either kept or discarded",
        );
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
      },
    });
    // Issue #3933: the exact scores that arrive for screened survivors must
    // reach the drift monitor. A bred offspring is screened *before* fitness
    // recomputes its UUID, so a monitor keyed on that UUID records nothing in
    // a real run and the false-optimum detector can never fire.
    const guard = neat.preSelection.surrogateGuard;
    assert(guard !== undefined, "a surrogate screen carries the #3933 guard");
    const diagnostics = guard.runDiagnostics;
    // Conditioned on there having been a prediction to difference: a
    // generation the model refused outright has no residual to offer, and the
    // defect this guards against produced *zero* residuals while predicting
    // most of the population.
    // Conditioned on there having been a screened generation *before* the last
    // one: a prediction is differenced against the exact score that arrives
    // for it in the following generation, so the final generation's
    // predictions are still outstanding when the loop ends. The defect this
    // guards against produced zero residuals however long the run was.
    assert(
      diagnostics.generations > 1 &&
        diagnostics.candidates > diagnostics.outOfDistribution
        ? diagnostics.residuals > 0
        : true,
      "the surrogate's predictions must be differenced against the exact " +
        "scores that arrived for them",
    );
    assert(
      diagnostics.exactSlots > 0,
      "the acquisition rule must have allocated this run's exact evaluations",
    );
  } finally {
    await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
    for (const worker of workers) worker.terminate();
  }
});

Deno.test("pre-selection wiring — a real evolve run reports the elite screen rank", async () => {
  // Issue #4008: the diagnostic that decides whether the screen is worth
  // having. A bred offspring is screened before fitness recomputes its UUID,
  // so a rank map keyed on that UUID stays empty for a whole production run
  // and the line is never logged — silently, because an empty list renders as
  // no line at all. Only a run through the real evolve loop catches it: a
  // fixture that assigns the UUID itself cannot.
  const dataDir = makeDataDir(buildDataSet(), 2000);
  const workers = [new WorkerHandler(dataDir, "MSE", true)];
  try {
    const seed = new Creature(2, 1, { layers: [{ count: 3 }] });
    const neat = new Neat(2, 1, {
      creatures: [seed.exportJSON()],
      populationSize: 30,
      elitism: 2,
      preSelection: { ratio: 3, screen: "surrogate" },
    }, workers);
    await neat.populatePopulation(seed);

    const { generations } = await evolveUntilScreened(neat, {
      until: () => neat.preSelection.eliteScreenRanks.length > 0,
    });

    const ranks = neat.preSelection.eliteScreenRanks;
    assert(
      ranks.length > 0,
      `no elite carried a screen rank over ${generations} generation(s): the ` +
        `stage records nothing for the creatures a real run actually breeds`,
    );
    for (const rank of ranks) {
      assert(
        rank.rank >= 0 && rank.rank < rank.of,
        `an elite's rank ${rank.rank} must sit inside the ${rank.of} ` +
          `candidates it was taken over`,
      );
    }
    assert(
      neat.preSelection.describeEliteRanks(ranks)?.includes(
        "elite screen rank",
      ),
      "the run must be able to write the elite screen rank line",
    );
  } finally {
    await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
    for (const worker of workers) worker.terminate();
  }
});

Deno.test("pre-selection wiring — a screened-out creature never reaches the archive", async () => {
  const dataDir = makeDataDir(buildDataSet(), 2000);
  const archiveDir = await Deno.makeTempDir({
    prefix: "pre-selection-archive-",
  });
  const workers = [new WorkerHandler(dataDir, "MSE", true)];
  try {
    const seed = new Creature(2, 1, { layers: [{ count: 3 }] });
    const neat = new Neat(2, 1, {
      creatures: [seed.exportJSON()],
      populationSize: 30,
      elitism: 1,
      preSelection: { ratio: 3, screen: "surrogate" },
      evaluationArchive: { enabled: true, directory: archiveDir },
    }, workers);
    await neat.populatePopulation(seed);

    let evaluable = 0;
    const { screenedOut } = await evolveUntilScreened(neat, {
      // Each generation evaluates the population it starts with, so that is
      // the most records the archive may gain from it.
      before: (population) => evaluable += population.length,
    });

    const archived = (await Deno.readTextFile(
      `${archiveDir}/${EVALUATION_ARCHIVE_FILE_NAME}`,
    )).split("\n").filter((line) => line.length > 0);
    assert(archived.length > 0, "the archive must have recorded something");
    // Every archived record is an exact evaluation of a creature that was in
    // the population. A screened-out creature never enters one, so an archive
    // holding more than the evaluated populations would mean a discard was
    // recorded.
    assert(
      archived.length <= evaluable,
      `the archive holds ${archived.length} records after ${evaluable} ` +
        `evaluable creatures and ${screenedOut} discards`,
    );
  } finally {
    await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
    for (const worker of workers) worker.terminate();
    await Deno.remove(archiveDir, { recursive: true });
  }
});

Deno.test("pre-selection wiring — an active stage never costs the run its elites", async () => {
  const dataDir = makeDataDir(buildDataSet(), 2000);
  const workers = [new WorkerHandler(dataDir, "MSE", true)];
  try {
    const seed = new Creature(2, 1, { layers: [{ count: 3 }] });
    const neat = new Neat(2, 1, {
      creatures: [seed.exportJSON()],
      populationSize: 30,
      elitism: 2,
      preSelection: { ratio: 3, screen: "surrogate" },
    }, workers);
    await neat.populatePopulation(seed);

    // Elites are not offspring, so the stage must never see them. The
    // observable consequence is this: the incumbent survives every generation
    // and its exact score never goes backwards. A screen let loose on the
    // elite band would eventually discard the incumbent, and the fittest would
    // regress.
    let incumbent: Creature | undefined;
    const { fittest } = await evolveUntilScreened(neat, {
      after: (_summary, current) => {
        if (incumbent?.score !== undefined) {
          assert(
            (current.score ?? -Infinity) >= incumbent.score,
            `the incumbent regressed from ${incumbent.score} to ` +
              `${current.score} while the stage was screening`,
          );
        }
        incumbent = current;
      },
    });
    assert(
      fittest.score !== undefined && Number.isFinite(fittest.score),
      "the run still exports a scored creature",
    );
  } finally {
    await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
    for (const worker of workers) worker.terminate();
  }
});
