/**
 * Issue #2947: Warm-up resume/accumulation observability.
 *
 * Verifies the operator-visible signals added so a frozen/resetting warm-up
 * counter is obvious at a glance (independent of the seeding fix #2945):
 *
 * 1. A single run-start resume log from `populatePopulation` carrying the
 *    accumulated `currentGeneration`, the configured `warmupGenerations`, the
 *    lock state, and the resume `source` (primary-seed vs population vs none).
 * 2. The `generation_complete` training event exposes the accumulated counter
 *    and a derived `warmupLockActive` boolean (via `buildWarmupEventFields`).
 * 3. The warm-up → warm transition (structural lock lifting) is logged exactly
 *    once per run when it occurs.
 * 4. No warm-up logging at all when warm-up is not configured.
 *
 * Tests capture an injected logger and assert on its emitted lines — a "what"
 * test on the observable output, not on implementation details.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import {
  buildWarmupEventFields,
  creatureForProblem,
  writeSeedWarmupProgressTags,
} from "@architecture/CreatureFactory.ts";
import type { Logger } from "@utils/Logger.ts";
import { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type {
  GenerationCompleteEvent,
  TrainingEvent,
} from "@config/TrainingEvent.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

const INPUTS = 3;
const OUTPUTS = 1;

/**
 * A logger that records every emitted info line, for assertions. Injected via
 * `NeatOptions.logger` (the documented integration path) because constructing
 * a Neat resets the global logger to `config.logger`.
 */
function captureLogger(): { logger: Logger; infos: string[] } {
  const infos: string[] = [];
  const logger: Logger = {
    debug() {},
    info(...args: unknown[]) {
      infos.push(args.map((a) => String(a)).join(" "));
    },
    warn() {},
    error() {},
  };
  return { logger, infos };
}

/** Lines emitted by the run-start resume log. */
function resumeLines(infos: string[]): string[] {
  return infos.filter((l) => l.includes("warm-up: resumed"));
}

/** Lines emitted by the lock-lift transition log. */
function liftLines(infos: string[]): string[] {
  return infos.filter((l) => l.includes("structural lock lifted"));
}

Deno.test("WarmupObservability: resume log reports primary-seed source while locked", async () => {
  const { logger, infos } = captureLogger();
  // Primary seed carries both the warm-up length and accumulated progress.
  const seed = creatureForProblem({
    inputs: INPUTS,
    outputs: OUTPUTS,
    cost: "MSE",
    warmupGenerations: 10,
  });
  writeSeedWarmupProgressTags(seed, 10, 4);

  const neat = new Neat(INPUTS, OUTPUTS, { populationSize: 4, logger }, []);
  await neat.populatePopulation(seed);

  const lines = resumeLines(infos);
  assertEquals(lines.length, 1, "resume log must be emitted exactly once");
  assert(
    lines[0].includes("currentGeneration=4"),
    `expected accumulated counter in: ${lines[0]}`,
  );
  assert(
    lines[0].includes("warmupGenerations=10"),
    `expected warm-up length in: ${lines[0]}`,
  );
  assert(
    lines[0].includes("lock active"),
    `expected active lock in: ${lines[0]}`,
  );
  assert(
    lines[0].includes("source=primary-seed"),
    `expected primary-seed source in: ${lines[0]}`,
  );
  // Lock-lift line must NOT fire — the lineage resumes still warming.
  assertEquals(liftLines(infos).length, 0);
});

Deno.test("WarmupObservability: resume log reports population source when the seed is tagless", async () => {
  const { logger, infos } = captureLogger();
  // Tagless factory seed: warm-up length but no accumulated progress.
  const seed = creatureForProblem({
    inputs: INPUTS,
    outputs: OUTPUTS,
    cost: "MSE",
    warmupGenerations: 10,
  });

  // A prior champion in the starting population carries the lineage counter.
  const champion = creatureForProblem({
    inputs: INPUTS,
    outputs: OUTPUTS,
    cost: "MSE",
    warmupGenerations: 10,
  });
  writeSeedWarmupProgressTags(champion, 10, 6);

  const neat = new Neat(
    INPUTS,
    OUTPUTS,
    { populationSize: 4, creatures: [champion.exportJSON()], logger },
    [],
  );
  await neat.populatePopulation(seed);

  const lines = resumeLines(infos);
  assertEquals(lines.length, 1, "resume log must be emitted exactly once");
  assert(
    lines[0].includes("currentGeneration=6"),
    `expected population-sourced counter in: ${lines[0]}`,
  );
  assert(
    lines[0].includes("source=population"),
    `expected population source in: ${lines[0]}`,
  );
  assert(lines[0].includes("lock active"), `expected active lock: ${lines[0]}`);
});

Deno.test("WarmupObservability: no warm-up configured logs nothing", async () => {
  const { logger, infos } = captureLogger();
  // No warmupGenerations tag — warm-up is not configured.
  const seed = creatureForProblem({
    inputs: INPUTS,
    outputs: OUTPUTS,
    cost: "MSE",
  });

  const neat = new Neat(INPUTS, OUTPUTS, { populationSize: 4, logger }, []);
  await neat.populatePopulation(seed);

  assertEquals(
    resumeLines(infos).length,
    0,
    "no resume log when warm-up is not configured",
  );
  assertEquals(liftLines(infos).length, 0);
});

Deno.test("WarmupObservability: buildWarmupEventFields surfaces accumulated counter and lock state", () => {
  // Not configured → undefined (fields absent on the event; zero overhead).
  assertEquals(buildWarmupEventFields(0, 5), undefined);
  assertEquals(buildWarmupEventFields(-1, 5), undefined);

  // Configured and still warming → lock active.
  assertEquals(buildWarmupEventFields(10, 5), {
    currentGeneration: 5,
    warmupLockActive: true,
  });

  // Configured and past the window → lock lifted.
  assertEquals(buildWarmupEventFields(10, 15), {
    currentGeneration: 15,
    warmupLockActive: false,
  });
});

Deno.test("WarmupObservability: lock-lift transition logs exactly once per run", async () => {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 12; i++) {
    records.push({
      input: new Float32Array(Array.from({ length: INPUTS }, () => 0.5)),
      output: new Float32Array(Array.from({ length: OUTPUTS }, () => 0.5)),
    });
  }
  const dataDir = makeDataDir(records, 2000);
  const workers = [new WorkerHandler(dataDir, "MSE", true)];

  try {
    const { logger, infos } = captureLogger();
    // Warm-up of 1 with the lineage already at the window edge: the very
    // next generation lifts the structural lock.
    const seed = creatureForProblem({
      inputs: INPUTS,
      outputs: OUTPUTS,
      cost: "MSE",
      warmupGenerations: 1,
    });
    writeSeedWarmupProgressTags(seed, 1, 1);

    const options: NeatOptions = { populationSize: 6, logger };
    const neat = new Neat(INPUTS, OUTPUTS, options, workers);
    await neat.populatePopulation(seed);

    // Resume log fired with the lock still active.
    const resume = resumeLines(infos);
    assertEquals(resume.length, 1);
    assert(resume[0].includes("lock active"), `expected active: ${resume[0]}`);

    // First generation crosses the window → lock lifts → logged once.
    await neat.evolve();
    assert(neat.currentGeneration > 1, "generation must advance past warm-up");
    const afterFirst = liftLines(infos);
    assertEquals(afterFirst.length, 1, "lock-lift must be logged once");
    assert(
      afterFirst[0].includes("warmupGenerations=1"),
      `expected warm-up length in lift line: ${afterFirst[0]}`,
    );

    // Subsequent generations must not re-log the transition.
    await neat.evolve();
    assertEquals(
      liftLines(infos).length,
      1,
      "lock-lift must not be logged again",
    );
  } finally {
    await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
    for (const w of workers) {
      w.terminate();
    }
  }
});

const TRAINING_SET = [
  { input: new Float32Array([0, 0, 0]), output: new Float32Array([0]) },
  { input: new Float32Array([1, 1, 1]), output: new Float32Array([1]) },
];

Deno.test("WarmupObservability: generation_complete carries accumulated counter and lock state while warming", async () => {
  const events: GenerationCompleteEvent[] = [];

  // Seed tagged with a long warm-up so the lock stays active across the run.
  const seed = new Creature(INPUTS, OUTPUTS, { layers: [{ count: 4 }] });
  writeSeedWarmupProgressTags(seed, 100, 5);

  await seed.evolveDataSet(TRAINING_SET, {
    iterations: 3,
    targetError: 0,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  assert(events.length > 0, "should emit generation_complete events");
  for (const event of events) {
    assertEquals(
      typeof event.currentGeneration,
      "number",
      "accumulated counter must be present while warming",
    );
    assert(
      (event.currentGeneration ?? 0) >= 5,
      `counter must include the resumed value, got ${event.currentGeneration}`,
    );
    assertEquals(
      event.warmupLockActive,
      true,
      "lock must be active throughout this short warm-up run",
    );
  }
});

Deno.test("WarmupObservability: generation_complete omits warm-up fields when warm-up is not configured", async () => {
  const events: GenerationCompleteEvent[] = [];

  // No warm-up tags — fields must be absent (zero overhead once warm).
  const seed = new Creature(INPUTS, OUTPUTS, { layers: [{ count: 4 }] });

  await seed.evolveDataSet(TRAINING_SET, {
    iterations: 3,
    targetError: 0,
    populationSize: 10,
    threads: 1,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });

  assert(events.length > 0, "should emit generation_complete events");
  for (const event of events) {
    assertEquals(event.currentGeneration, undefined);
    assertEquals(event.warmupLockActive, undefined);
  }
});
