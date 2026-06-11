/**
 * Issue #2912: Multi-run seed warm-up regression test.
 *
 * End-to-end proof that the warm-up generation count accumulates across the
 * production save → reload → resume cycle, that the structural lock stays
 * active throughout the warm-up window, and that both warm-up tags disappear
 * from exports once warm-up completes.
 *
 * Production evidence (`GRQ-24-100.json`): a file stuck at
 * `currentGeneration: 1` after a week of 15-minute runs against
 * `warmupGenerations: 1440` — the gate could never lift because the saved
 * tag never accumulated across runs. The fix chain #2908..#2911:
 *
 * - #2908: `populatePopulation` seeds the lineage counter monotonically from
 *   the saved `currentGeneration` tag (resume from the highest saved value).
 * - #2831/#2909: the export boundary stamps the accumulated counter
 *   (monotonic-max) while warming and strips both tags once warm.
 * - #2911: mid-run offspring no longer carry warm-up tags.
 *
 * This test simulates several short runs end-to-end using those real
 * production paths and asserts accumulation, gate-lift, and tag removal all
 * within one scenario. It would fail against the pre-#2908 behaviour where
 * the saved tag sticks at the seed value (each run resetting to the same
 * per-run count rather than accumulating).
 *
 * Kept fast: tiny network, tiny population, a couple of generations per run,
 * no real training workers (the lineage counter increment is exactly what
 * `evolve()` does — `NeatEvolution.ts` `neat.currentGeneration++`).
 */
import { assert, assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  applySeedWarmupTagsAtSave,
  creatureForProblem,
  CURRENT_GENERATION_TAG,
  isSeedWarmupStructuralLockActive,
  readCurrentGenerationFromCreature,
  WARMUP_GENERATIONS_TAG,
} from "@architecture/CreatureFactory.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Mutation } from "@neat/Mutation.ts";
import { Mutator } from "@neat/Mutator.ts";
import {
  DiscoveryReplayQueue,
  type DiscoveryReplayQueueDeps,
} from "@neat/DiscoveryReplayQueue.ts";
import {
  createSeededRng,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { makeForwardOnlyCreature } from "../fixtures/SimpleCreatures.ts";

// ─── Production-shaped parameters (kept tiny for speed) ───────────────────────
const INPUTS = 3;
const OUTPUTS = 1;
const WARMUP = 5; // small warm-up window
const GENS_PER_RUN = 2; // ~2 generations per short "run"
const POP = 4; // tiny population

/** Mutations excluded during seed warm-up (structural reduction / squash change). */
const WARMUP_BLOCKED = new Set([
  Mutation.SUB_NODE.name,
  Mutation.SUB_CONN.name,
  Mutation.MOD_SQUASH.name,
  Mutation.SWAP_NODES.name,
  Mutation.ADD_SELF_CONN.name,
  Mutation.SUB_SELF_CONN.name,
  Mutation.ADD_BACK_CONN.name,
  Mutation.SUB_BACK_CONN.name,
]);

const REPLAY_OPTIONS: NeatOptions = {
  discoveryCacheDir: "/tmp/cache",
  costOfGrowth: 0,
};

/** Tracking deps for the replay queue — counts how many replays actually ran. */
function trackingReplayDeps(): {
  deps: DiscoveryReplayQueueDeps;
  calls: () => number;
} {
  let started = 0;
  const deps: DiscoveryReplayQueueDeps = {
    replayDir: () => {
      started++;
      return Promise.resolve({
        original: { error: 0.5, score: 0.5 },
        evaluatedSingles: 0,
        evaluatedCombos: 0,
        pruned: 0,
        skippedAlreadyApplied: 0,
        skippedNotApplicable: 0,
      });
    },
  };
  return { deps, calls: () => started };
}

/**
 * Assert the structural lock is genuinely enforced at `(warmup, generation)`:
 * the Mutator never selects a structure-reducing/squash mutation, and the
 * DiscoveryReplayQueue skips replay entirely.
 */
async function assertStructuralLockActive(
  warmupGenerations: number,
  generation: number,
): Promise<void> {
  assert(
    isSeedWarmupStructuralLockActive(warmupGenerations, generation),
    `lock should be active at gen ${generation}/${warmupGenerations}`,
  );

  // Mutator: structure-reducing / squash mutations filtered out. The Mutator
  // gates on a known in-window generation (> 0); at generation 0 the seed has
  // no counter yet and only the conservative replay lock applies.
  if (generation > 0) {
    setRandomNumberGenerator(createSeededRng(123));
    const config = createNeatConfig({
      populationSize: 10,
      mutation: [
        ...Mutation.FFW,
        ...Mutation.ALL.filter((m) =>
          !Mutation.FFW.some((f) => f.name === m.name)
        ),
      ],
      feedbackLoop: true,
    });
    const mutator = new Mutator(config);
    mutator.setWarmupContext(warmupGenerations, generation);
    const creature = new Creature(INPUTS, OUTPUTS, { layers: [{ count: 8 }] });
    for (let i = 0; i < 200; i++) {
      const method = mutator.selectMutationMethod(creature);
      assert(
        !WARMUP_BLOCKED.has(method.name),
        `warm-up must not select structural mutation ${method.name}`,
      );
    }
  }

  // Discovery replay: skipped while the lock is active.
  const { deps, calls } = trackingReplayDeps();
  const queue = new DiscoveryReplayQueue(deps);
  queue.scheduleReplay(
    makeForwardOnlyCreature(),
    "/tmp/data",
    REPLAY_OPTIONS,
    undefined,
    { warmupGenerations, currentGeneration: generation },
  );
  await queue.waitForCompletion();
  assertEquals(calls(), 0, "discovery replay must be skipped during warm-up");
}

/** Assert replay runs once the warm-up window has elapsed. */
async function assertStructuralLockReleased(
  warmupGenerations: number,
  generation: number,
): Promise<void> {
  assert(
    !isSeedWarmupStructuralLockActive(warmupGenerations, generation),
    `lock should be released at gen ${generation}/${warmupGenerations}`,
  );
  const { deps, calls } = trackingReplayDeps();
  const queue = new DiscoveryReplayQueue(deps);
  queue.scheduleReplay(
    makeForwardOnlyCreature(),
    "/tmp/data",
    REPLAY_OPTIONS,
    undefined,
    { warmupGenerations, currentGeneration: generation },
  );
  await queue.waitForCompletion();
  assertEquals(calls(), 1, "discovery replay must run once warm-up elapses");
}

interface RunResult {
  /** JSON exported through the real save boundary, ready to reload next run. */
  savedJson: CreatureExport;
  /** Neat-level warm-up length read from the reloaded seed. */
  warmupGenerations: number;
  /** Lineage counter on resume (before evolving this run). */
  startGeneration: number;
  /** Lineage counter after this run's generations. */
  endGeneration: number;
}

/**
 * Simulate one short production run: reload the saved JSON into a fresh Neat
 * (the real resume path), evolve `gensThisRun` generations (the real
 * per-generation counter increment), then export the fittest through the real
 * save boundary (`applySeedWarmupTagsAtSave`, exactly as `writeCreatures`).
 */
async function simulateRun(
  savedJson: CreatureExport,
  gensThisRun: number,
): Promise<RunResult> {
  const neat = new Neat(INPUTS, OUTPUTS, { populationSize: POP }, []);
  await neat.populatePopulation(Creature.fromJSON(savedJson));

  const startGeneration = neat.currentGeneration;
  for (let g = 0; g < gensThisRun; g++) {
    // Exactly what evolve() does once per generation (NeatEvolution.ts).
    neat.currentGeneration++;
  }
  const endGeneration = neat.currentGeneration;

  // Save boundary: stamp the fittest's export from the Neat-level counter.
  const json = neat.population[0].exportJSON();
  applySeedWarmupTagsAtSave(
    json,
    neat.warmupGenerations,
    neat.currentGeneration,
  );

  return {
    savedJson: json,
    warmupGenerations: neat.warmupGenerations,
    startGeneration,
    endGeneration,
  };
}

Deno.test("SeedWarmupAccumulation: count accumulates across save/reload/resume, gate lifts, tags drop", async () => {
  // Seed a factory creature carrying the warm-up tag (no progress yet).
  const seed = creatureForProblem({
    inputs: INPUTS,
    outputs: OUTPUTS,
    cost: "MSE",
    warmupGenerations: WARMUP,
  });
  let savedJson: CreatureExport = seed.exportJSON();

  // Track the saved generation per run while warming.
  const savedWhileWarming: number[] = [];
  let warmReachedAtRun = -1;

  // A few short runs step the counter from 0 past the warm-up window of 5.
  for (let run = 0; run < 6 && warmReachedAtRun < 0; run++) {
    // deno-lint-ignore no-await-in-loop
    const result = await simulateRun(savedJson, GENS_PER_RUN);
    savedJson = result.savedJson;

    const reloaded = Creature.fromJSON(savedJson);
    const savedGen = readCurrentGenerationFromCreature(reloaded);
    const warming = result.warmupGenerations > 0 &&
      result.startGeneration <= result.warmupGenerations;

    if (warming) {
      // Structural lock must be enforced on resume during the warm-up window.
      // deno-lint-ignore no-await-in-loop
      await assertStructuralLockActive(
        result.warmupGenerations,
        result.startGeneration,
      );
    }

    if (
      result.warmupGenerations > 0 &&
      result.endGeneration <= result.warmupGenerations
    ) {
      // Still warming after this run — the save carries the accumulated tags.
      assertEquals(
        savedGen,
        result.endGeneration,
        "saved tag must carry the accumulated counter while warming",
      );
      savedWhileWarming.push(savedGen);
    } else {
      // First run that crosses the window: warm-up tags must be stripped.
      warmReachedAtRun = run;
      assertEquals(
        getTag(reloaded, WARMUP_GENERATIONS_TAG),
        null,
        "warmupGenerations tag must be stripped once warm",
      );
      assertEquals(
        getTag(reloaded, CURRENT_GENERATION_TAG),
        null,
        "currentGeneration tag must be stripped once warm",
      );
      // The gate has lifted: replay resumes at the warm generation.
      // deno-lint-ignore no-await-in-loop
      await assertStructuralLockReleased(WARMUP, result.endGeneration);
    }
  }

  // ── Accumulation: the saved generation strictly increases run-over-run and
  //    exceeds a single run's count — proving cross-run accumulation rather
  //    than the pre-#2908 per-run reset (the production "stuck at seed" bug). ──
  assert(
    savedWhileWarming.length >= 2,
    "expected at least two warming runs to compare",
  );
  for (let i = 1; i < savedWhileWarming.length; i++) {
    assert(
      savedWhileWarming[i] > savedWhileWarming[i - 1],
      `saved generation must strictly increase across runs, got ${
        savedWhileWarming.join(",")
      }`,
    );
  }
  assert(
    savedWhileWarming[savedWhileWarming.length - 1] > GENS_PER_RUN,
    `accumulated count (${
      savedWhileWarming.join(",")
    }) must exceed one run's generations (${GENS_PER_RUN}); ` +
      "a stuck seed tag would never pass this",
  );

  // ── Gate lift + tag removal were asserted inside the loop; confirm we did
  //    cross the window within the scenario. ──
  assert(warmReachedAtRun >= 0, "warm-up window must lift within the scenario");
});

Deno.test("SeedWarmupAccumulation: a run shorter than the window can never lift the gate alone", async () => {
  // Reproduces the production failure mode directly: with a warm-up window far
  // larger than a single run's generations, no single run can lift the gate —
  // only accumulation across saved/reloaded runs can. Each run must resume
  // from the previous saved value rather than restarting at zero.
  const bigWarmup = 8;
  const gensPerShortRun = 2;
  const seed = creatureForProblem({
    inputs: INPUTS,
    outputs: OUTPUTS,
    cost: "MSE",
    warmupGenerations: bigWarmup,
  });
  let savedJson: CreatureExport = seed.exportJSON();

  let lastSavedGen = 0;
  let runs = 0;
  // Drive runs until the saved tags are stripped (warm) — bounded so a
  // regression (stuck tag) fails fast instead of looping forever.
  while (runs < 8) {
    // deno-lint-ignore no-await-in-loop
    const result = await simulateRun(savedJson, gensPerShortRun);
    savedJson = result.savedJson;
    runs++;

    const reloaded = Creature.fromJSON(savedJson);
    const savedGen = readCurrentGenerationFromCreature(reloaded);

    if (result.endGeneration > bigWarmup) {
      // Warm: both tags gone, counter genuinely accumulated past the window.
      assertEquals(getTag(reloaded, WARMUP_GENERATIONS_TAG), null);
      assertEquals(getTag(reloaded, CURRENT_GENERATION_TAG), null);
      assert(
        lastSavedGen >= bigWarmup - gensPerShortRun,
        "counter must have accumulated to the window edge before lifting",
      );
      break;
    }

    // Each run must advance the saved counter — never stuck at the seed value.
    assert(
      savedGen > lastSavedGen,
      `saved generation must advance each run; was ${lastSavedGen}, now ${savedGen}`,
    );
    lastSavedGen = savedGen;
  }

  assert(
    runs < 8,
    "warm-up must lift through accumulation within the bounded run count",
  );
});
