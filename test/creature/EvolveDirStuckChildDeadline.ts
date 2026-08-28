import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { evolveDir } from "@creature/CreatureTraining.ts";
import type { EvolveDirDeps } from "@creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { computeHardDeadlineTS } from "@neat/HardDeadline.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * GRQ #4470: `evolveDir` must end at its own deadline when a discovery or
 * training child never settles.
 *
 * On GRQ-22 a `location` evolve child went silent and the run continued ~19×
 * past `timeoutMinutes + grace` until the external 3 h cap killed the task
 * mid-`evolve` — so the caller's check-in stage never ran and a completed
 * improvement was thrown away.
 *
 * Two holes are covered here, both driven by an injected clock (#2888 — no
 * real waits, no elapsed-time assertions):
 *
 * 1. **The loop could keep starting generations past the cap.** The hard
 *    deadline was only consulted inside two conditional branches (the over-run
 *    branch and the `completed` branch). A generation that neither completes
 *    nor trips the over-run predicate went straight back to `evolve()` without
 *    ever looking at the cap.
 * 2. **A generation that never returns pinned the loop inside `evolve()`.**
 *    When the wedged child holds the resources the next generation needs, the
 *    `await neat.evolve()` never settles, so no branch of the loop is ever
 *    reached again.
 *
 * Every stub child here is a promise that can *never* settle
 * (`new Promise(() => {})`), and each test asserts the injected clock advanced
 * past the hard deadline while that promise was still pending — so a test can
 * not pass because the stub quietly resolved on its own.
 */

/** Minimal 2-in / 1-out dataset; the model never needs to converge here. */
function tinyDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

function makeRecordingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  const logger: Logger = {
    debug: record,
    info: record,
    warn: record,
    error: record,
  };
  return { logger, lines };
}

/** A child task that can never settle, plus a flag proving it never did. */
function neverSettlingChild(): {
  promise: Promise<void>;
  settled: () => boolean;
} {
  let settled = false;
  const promise = new Promise<void>(() => {});
  promise.then(() => {
    settled = true;
  });
  return { promise, settled: () => settled };
}

/**
 * Fail loudly instead of hanging the suite: a regression here wedges
 * `evolveDir` forever, and a wedged worker is exactly the fault under test.
 */
function withRealTimeGuard<T>(
  work: Promise<T>,
  label: string,
  timeoutMS = 20_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}: evolveDir did not return`)),
      timeoutMS,
    );
  });
  return Promise.race([work, guard]).finally(() =>
    clearTimeout(timer)
  ) as Promise<T>;
}

/** Load every persisted creature from a `creatureStore` directory. */
async function loadStoredCreatures(dir: string): Promise<Creature[]> {
  const creatures: Creature[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const json = JSON.parse(await Deno.readTextFile(`${dir}/${entry.name}`));
    creatures.push(Creature.fromJSON(json));
  }
  return creatures;
}

const TIMEOUT_MINUTES = 1;
/** Hard cap for a 1-minute run: 1 min + min(15, 1) min grace = start + 120 s. */
function hardDeadlineFor(startMS: number): number {
  const deadline = computeHardDeadlineTS(startMS, TIMEOUT_MINUTES);
  assert(deadline !== undefined, "a configured timeout must produce a cap");
  return deadline;
}

/**
 * Shared body for the discovery / training variants of the "loop must not keep
 * starting generations past the cap" regression.
 *
 * `overrunEnforcementFactor` is raised so the graceful over-run branch stays
 * inert: this test is about the *hard deadline* being enforced on its own,
 * not about over-run self-termination masking it.
 */
async function assertLoopEndsAtHardDeadline(
  kind: "discovery" | "training",
): Promise<void> {
  await initWasmForTests();

  const dataSetDir = makeDataDir(tinyDataSet(), 2000);
  const creatureStore = await Deno.makeTempDir({
    prefix: `neat-4470-${kind}-`,
  });
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

  // Anchor on the real clock so finishGeneration's own `Date.now()` timeout
  // check stays false — only the injected clock crosses the cap.
  const startMS = Date.now();
  const hardDeadlineMS = hardDeadlineFor(startMS);
  let nowMS = startMS;

  const child = neverSettlingChild();
  let captured: Neat | undefined;
  let clockPastDeadlineWhilePending = false;

  const { logger, lines } = makeRecordingLogger();
  const options: NeatOptions = {
    populationSize: 6,
    // Far more iterations than the run can reach, so `completed` stays false
    // and the loop keeps wanting to start another generation.
    iterations: 500,
    timeoutMinutes: TIMEOUT_MINUTES,
    threads: 1,
    creatureStore,
    logger,
    onTrainingEvent: (event) => {
      if (event.kind === "generation_complete" && event.generation === 1) {
        // Mid-run: the injected clock crosses the hard cap while the stub
        // child is still pending.
        nowMS = hardDeadlineMS + 60_000;
        clockPastDeadlineWhilePending = !child.settled();
      }
    },
  };

  const deps: EvolveDirDeps = {
    startTimeMS: startMS,
    now: () => nowMS,
    // Over-run would need elapsed > 10 minutes; the clock only reaches ~3.
    overrunEnforcementFactor: 10,
    onNeatReady: (neat) => {
      captured = neat;
      const map = kind === "discovery"
        ? neat.discoveryInProgress
        : neat.trainingInProgress;
      map.set(`stuck-${kind}`, child.promise);
    },
  };

  const priorLogger = getLogger();
  try {
    const result = await withRealTimeGuard(
      evolveDir(creature, dataSetDir, options, deps),
      `never-settling ${kind} child`,
    );

    assert(
      clockPastDeadlineWhilePending,
      "the injected clock must pass the hard deadline while the child is pending",
    );
    assert(
      !child.settled(),
      "the stub child must never settle — otherwise the cap is not what ended the run",
    );
    assert(nowMS > hardDeadlineMS, "injected clock must be past the cap");

    assertEquals(
      result.terminationReason,
      "hard-deadline",
      "the run must report the hard deadline as the reason it stopped",
    );
    assertEquals(
      result.generation,
      1,
      "no further generation may start once the cap has passed",
    );
    assert(
      Number.isFinite(result.score),
      "the evolved population must still commit a finite best score",
    );

    assert(captured, "onNeatReady must have handed back the Neat instance");
    assertEquals(
      captured.discoveryInProgress.size,
      0,
      "discoveryInProgress must be empty once the cap abandons in-flight work",
    );
    assertEquals(
      captured.trainingInProgress.size,
      0,
      "trainingInProgress must be empty once the cap abandons in-flight work",
    );

    const stored = await loadStoredCreatures(creatureStore);
    assert(
      stored.length > 0,
      "the evolved population must be written, not thrown away",
    );

    const joined = lines.join("\n");
    assert(
      joined.includes("Hard deadline (timeoutMinutes + grace) exceeded"),
      "the abandon must be logged when it happens",
    );
    assert(
      joined.includes(`1 ${kind}`),
      `the log line must name the abandoned ${kind} task`,
    );
  } finally {
    setLogger(priorLogger);
    await Deno.remove(dataSetDir, { recursive: true });
    await Deno.remove(creatureStore, { recursive: true });
  }
}

Deno.test({
  name:
    "evolveDir hard deadline: a never-settling discovery child cannot keep the loop starting generations",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => assertLoopEndsAtHardDeadline("discovery"),
});

Deno.test({
  name:
    "evolveDir hard deadline: a never-settling training child cannot keep the loop starting generations",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => assertLoopEndsAtHardDeadline("training"),
});

Deno.test({
  name:
    "evolveDir hard deadline: a generation wedged behind a never-settling child still returns control",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({
      prefix: "neat-4470-wedge-",
    });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    const startMS = Date.now();
    const hardDeadlineMS = hardDeadlineFor(startMS);
    let nowMS = startMS;

    const child = neverSettlingChild();
    let captured: Neat | undefined;
    let wedgedGenerations = 0;

    const { logger, lines } = makeRecordingLogger();
    const options: NeatOptions = {
      populationSize: 6,
      iterations: 500,
      timeoutMinutes: TIMEOUT_MINUTES,
      threads: 1,
      creatureStore,
      logger,
    };

    const deps: EvolveDirDeps = {
      startTimeMS: startMS,
      now: () => nowMS,
      overrunEnforcementFactor: 10,
      onNeatReady: (neat) => {
        captured = neat;
        neat.discoveryInProgress.set("stuck-discovery", child.promise);

        // The wedge itself: once the child is in flight it holds the resources
        // the next generation needs, so that generation never settles. Stubbed
        // here because CI has no Rust FFI to hang for real — the loop must
        // still hand control back at its own cap.
        const realEvolve = neat.evolve.bind(neat);
        let evolveCalls = 0;
        neat.evolve = (best?: Creature) => {
          evolveCalls++;
          if (evolveCalls === 1) {
            return realEvolve(best);
          }
          wedgedGenerations++;
          nowMS = hardDeadlineMS + 60_000;
          return new Promise<never>(() => {});
        };
      },
    };

    const priorLogger = getLogger();
    try {
      const result = await withRealTimeGuard(
        evolveDir(creature, dataSetDir, options, deps),
        "generation wedged behind a never-settling child",
      );

      assertEquals(
        wedgedGenerations,
        1,
        "the wedged generation must be entered exactly once",
      );
      assert(
        !child.settled(),
        "the stub child must never settle — the cap is what ended the run",
      );
      assert(nowMS > hardDeadlineMS, "injected clock must be past the cap");

      assertEquals(
        result.terminationReason,
        "hard-deadline",
        "a run abandoned mid-generation must report the hard deadline",
      );
      assertEquals(
        result.generation,
        1,
        "only the generation that completed may be counted",
      );
      assert(
        Number.isFinite(result.score),
        "the population evolved before the wedge must still be returned",
      );

      assert(captured, "onNeatReady must have handed back the Neat instance");
      assertEquals(
        captured.discoveryInProgress.size,
        0,
        "in-flight discovery must be abandoned by the cap",
      );

      const stored = await loadStoredCreatures(creatureStore);
      assert(
        stored.length > 0,
        "the evolved population must be written, not thrown away",
      );

      const joined = lines.join("\n");
      assert(
        joined.includes("Hard deadline (timeoutMinutes + grace) exceeded"),
        "the abandon must be logged when it happens",
      );
      assert(
        joined.includes("abandoning the in-flight generation"),
        "the log must say the wedged generation itself was abandoned",
      );
    } finally {
      setLogger(priorLogger);
      await Deno.remove(dataSetDir, { recursive: true });
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});
