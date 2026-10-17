import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import {
  evolveDir,
  type EvolveDirDeps,
  evolveEnv,
  evolveRL,
} from "../../src/creature/CreatureTraining.ts";
import type { Neat } from "@neat/Neat.ts";
import { WorkerHandlerBase } from "@workers/WorkerHandlerBase.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import type { LegacyEpisodeAdapter } from "@creature/EpisodicFitnessTypes.ts";
import { EpisodeAdapter, type StepResult } from "@creature/EpisodeAdapter.ts";
import { EpisodeWorkerPool } from "@creature/EpisodeWorkerPool.ts";
import {
  getDistanceCacheSize,
  setCachedDistance,
} from "@breed/DistanceCache.ts";
import { initWasmForTests } from "../_initWasm.ts";
import { assertEvolveCallerUsable } from "@creature/EvolveTeardown.ts";
import SeedRewardAdapterFixture from "./fixtures/SeedRewardAdapterFixture.ts";

// Issue #4072: when the generation loop throws, `evolveDir` / `evolveEnv` /
// `evolveRL` must release everything they took for the run: every
// WorkerHandler is terminated (evolveDir), the episode worker pool is terminated
// (evolveRL), the population other than the caller is disposed, the distance
// cache is released, the SIGTERM listener is removed, and for evolveEnv /
// evolveRL the `options.signal` 'abort' listener is removed. The original
// rejection must reach the caller, a cleanup error must never replace it, and a
// second run in the same process must start clean.
//
// The run is driven by an injected clock (#2888): `now` and `startTimeMS` are
// pinned to a far-future constant, so no real elapsed time is read. The
// generation loop is failed by replacing `neat.evolve` with a rejecting stub.
// Deno's signal API and the abort signal's listener methods are wrapped for the
// duration of each test and restored in `finally`.

const TIMEOUT_MINUTES = 5;
// Constant far-future start. Every deadline is derived from it, so no real
// elapsed time is read.
const START_MS = Date.UTC(3000, 0, 1);

const SEED_REWARD_FIXTURE_URL = new URL(
  "./fixtures/SeedRewardAdapterFixture.ts",
  import.meta.url,
).href;

const silentLogger: Logger = {
  debug: (..._args: unknown[]) => {},
  info: (..._args: unknown[]) => {},
  warn: (..._args: unknown[]) => {},
  error: (..._args: unknown[]) => {},
};

/** Minimal 2-in / 1-out dataset; the model never needs to converge here. */
function tinyDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

/** Single-tick adapter that can never reach `targetError`. */
function buildEnvAdapter(): LegacyEpisodeAdapter<null, number> {
  return {
    inputCount: 1,
    outputCount: 1,
    maxSteps: 1,
    reset(_seed?: number): null {
      return null;
    },
    observe(_state: null): Float32Array {
      return new Float32Array([1.0]);
    },
    decode(output: Float32Array): number {
      return output[0];
    },
    step(_state: null, action: number) {
      return { state: null, reward: -Math.abs(action - 99), done: true };
    },
  };
}

/** Single-tick RL adapter that can never reach `targetError`. */
class UnreachableAdapter extends EpisodeAdapter<null, number> {
  override reset(_seed: number): { observation: Float32Array; state: null } {
    return { observation: new Float32Array([1.0]), state: null };
  }
  override step(
    _state: null,
    action: number,
  ): StepResult<Float32Array> & { state: null } {
    return {
      observation: new Float32Array([0]),
      reward: -Math.abs(action - 99),
      terminated: true,
      truncated: false,
      state: null,
    };
  }
  override get observationLength(): number {
    return 1;
  }
  override decodeAction(creatureOutput: Float32Array): number {
    return creatureOutput[0];
  }
  override maxSteps(): number {
    return 1;
  }
}

/** Live SIGTERM listeners, as seen through `Deno.addSignalListener`. */
interface SigtermLedger {
  adds: number;
  live: Set<() => void>;
  restore(): void;
}

/** Wrap Deno's signal API so every SIGTERM add/remove is recorded. */
function watchSigterm(): SigtermLedger {
  const originalAdd = Deno.addSignalListener;
  const originalRemove = Deno.removeSignalListener;
  const ledger: SigtermLedger = {
    adds: 0,
    live: new Set<() => void>(),
    restore: () => {
      Deno.addSignalListener = originalAdd;
      Deno.removeSignalListener = originalRemove;
    },
  };
  Deno.addSignalListener = (signal, handler) => {
    if (signal === "SIGTERM") {
      ledger.adds++;
      ledger.live.add(handler);
    }
    originalAdd(signal, handler);
  };
  Deno.removeSignalListener = (signal, handler) => {
    if (signal === "SIGTERM") ledger.live.delete(handler);
    originalRemove(signal, handler);
  };
  return ledger;
}

/** Live 'abort' listeners registered on one AbortSignal instance. */
interface AbortLedger {
  adds: number;
  live: Set<EventListenerOrEventListenerObject>;
  restore(): void;
}

/** Wrap an AbortSignal's listener methods so 'abort' add/remove is recorded. */
function watchAbort(signal: AbortSignal): AbortLedger {
  type Add = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  type Remove = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => void;
  const originalAdd = signal.addEventListener.bind(signal) as Add;
  const originalRemove = signal.removeEventListener.bind(signal) as Remove;
  const ledger: AbortLedger = {
    adds: 0,
    live: new Set<EventListenerOrEventListenerObject>(),
    restore: () => {
      Reflect.deleteProperty(signal, "addEventListener");
      Reflect.deleteProperty(signal, "removeEventListener");
    },
  };
  signal.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === "abort" && listener) {
      ledger.adds++;
      ledger.live.add(listener);
    }
    if (listener) originalAdd(type, listener, options);
  }) as AbortSignal["addEventListener"];
  signal.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) => {
    if (type === "abort" && listener) ledger.live.delete(listener);
    if (listener) originalRemove(type, listener, options);
  }) as AbortSignal["removeEventListener"];
  return ledger;
}

/** Workers whose `terminate()` has been called, across every instance. */
interface TerminateLedger {
  terminated: Set<unknown>;
  restore(): void;
}

/**
 * Wrap `WorkerHandlerBase.prototype.terminate`, which `WorkerHandler` inherits,
 * so each instance that is asked to stop is recorded by identity.
 */
function watchTerminate(): TerminateLedger {
  const proto = WorkerHandlerBase.prototype;
  const original = proto.terminate;
  const ledger: TerminateLedger = {
    terminated: new Set<unknown>(),
    restore: () => {
      proto.terminate = original;
    },
  };
  proto.terminate = function (this: unknown) {
    ledger.terminated.add(this);
    return original.call(this as WorkerHandlerBase<never, never>);
  };
  return ledger;
}

/** Episode worker pools created and terminated, counted across every instance. */
interface PoolLedger {
  creations: number;
  terminations: number;
  restore(): void;
}

/**
 * Wrap the static `EpisodeWorkerPool.create` and the instance `terminate` so
 * every pool built and every pool stopped is counted.
 */
function watchEpisodeWorkerPool(): PoolLedger {
  const originalCreate = EpisodeWorkerPool.create;
  const originalTerminate = EpisodeWorkerPool.prototype.terminate;
  const ledger: PoolLedger = {
    creations: 0,
    terminations: 0,
    restore: () => {
      EpisodeWorkerPool.create = originalCreate;
      EpisodeWorkerPool.prototype.terminate = originalTerminate;
    },
  };
  EpisodeWorkerPool.create = (options) => {
    ledger.creations++;
    return originalCreate.call(EpisodeWorkerPool, options);
  };
  EpisodeWorkerPool.prototype.terminate = function (this: EpisodeWorkerPool) {
    ledger.terminations++;
    originalTerminate.call(this);
  };
  return ledger;
}

/** Worker terminations that succeed, then throw (Issue #4072). */
interface FailingTerminateLedger {
  calls: number;
  restore(): void;
}

/**
 * Make every `WorkerHandlerBase.prototype.terminate()` stop the worker and then
 * throw, so a cleanup failure can be checked against the original rejection.
 */
function failingTerminate(): FailingTerminateLedger {
  const proto = WorkerHandlerBase.prototype;
  const original = proto.terminate;
  const ledger: FailingTerminateLedger = {
    calls: 0,
    restore: () => {
      proto.terminate = original;
    },
  };
  proto.terminate = function (this: unknown) {
    ledger.calls++;
    original.call(this as WorkerHandlerBase<never, never>);
    throw new Error("terminate failed");
  };
  return ledger;
}

/** Make the first `neat.evolve()` reject with `failure`, counting the calls. */
function rejectEvolve(
  neat: Neat,
  failure: Error,
  counter: { calls: number },
): void {
  neat.evolve = (() => {
    counter.calls++;
    return Promise.reject(failure);
  }) as Neat["evolve"];
}

/** What the champion-carrying `neat.evolve()` calls saw (Issue #4072). */
interface ChampionLedger {
  calls: number;
  championNeurons: number;
  champion?: Creature;
}

/**
 * Let the first `neat.evolve()` run for real, so a champion is adopted, then make
 * the second call reject with `failure`. The loop passes the champion into every
 * `evolve()` call, so the rejecting call records it for a disposal check.
 */
function rejectAfterChampion(
  neat: Neat,
  failure: Error,
  ledger: ChampionLedger,
): void {
  const realEvolve = neat.evolve.bind(neat);
  neat.evolve = ((previousFittest?: Creature) => {
    ledger.calls++;
    if (ledger.calls === 1) return realEvolve(previousFittest);
    ledger.champion = previousFittest;
    ledger.championNeurons = previousFittest?.neurons.length ?? 0;
    return Promise.reject(failure);
  }) as Neat["evolve"];
}

/** Assert the champion adopted in generation 1 was disposed by the failure path. */
function assertChampionDisposed(ledger: ChampionLedger): void {
  assertEquals(
    ledger.calls,
    2,
    "generation 2 must be entered once, after a real generation 1",
  );
  const champion = ledger.champion;
  assert(
    champion !== undefined,
    "positive control: generation 2 must be handed a champion",
  );
  assert(
    ledger.championNeurons > 0,
    "positive control: the champion must hold neurons before the failure",
  );
  assertEquals(
    champion.neurons.length,
    0,
    "the champion must be disposed after a rejected generation",
  );
}

/**
 * Seed one distance-cache entry and return the cache size straight after, so a
 * later assertion can prove the release actually emptied something (Issue #4072).
 */
function seedDistanceCache(): number {
  setCachedDistance("uuid-4072-a", "uuid-4072-b", 0.5);
  return getDistanceCacheSize();
}

/**
 * Assert every population member other than the caller was disposed, with a
 * positive control that the population held a member other than the caller.
 */
function assertPopulationDisposed(
  population: readonly Creature[],
  creature: Creature,
): void {
  assert(
    population.some((member) => member !== creature),
    "positive control: the population must hold at least one member other than the caller",
  );
  for (const member of population) {
    if (member === creature) continue;
    assertEquals(
      member.neurons.length,
      0,
      "every population member other than the caller must be disposed after a rejected generation",
    );
  }
}

/** Assert the caller still holds its genome and can be exported. */
function assertCallerUsable(creature: Creature): void {
  assert(
    creature.neurons.length >= creature.input + creature.output,
    `the caller must keep its input and output neurons, got ${creature.neurons.length}`,
  );
  assertEquals(creature.exportJSON().input, creature.input);
}

Deno.test({
  name:
    "evolveDir: a rejected generation terminates every worker, removes its SIGTERM listener, and a second run starts clean (Issue #4072)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({ prefix: "neat-4072-dir-" });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const failure = new Error("boom");
    const priorLogger = getLogger();
    const sigterm = watchSigterm();
    const terminate = watchTerminate();

    try {
      const workers: Neat["workers"] = [];
      let population: Creature[] = [];
      let seededCacheSize = 0;
      const counter = { calls: 0 };
      const deps: EvolveDirDeps = {
        startTimeMS: START_MS,
        now: () => START_MS,
        onNeatReady: (neat) => {
          workers.push(...neat.workers);
          population = [...neat.population];
          seededCacheSize = seedDistanceCache();
          rejectEvolve(neat, failure, counter);
        },
      };

      let caught: unknown;
      try {
        await evolveDir(creature, dataSetDir, {
          populationSize: 6,
          iterations: 500,
          timeoutMinutes: TIMEOUT_MINUTES,
          threads: 2,
          creatureStore,
          logger: silentLogger,
        }, deps);
      } catch (error) {
        caught = error;
      }

      assertEquals(counter.calls, 1, "generation 1 must be entered once");
      assertEquals(caught, failure, "the original rejection must be rethrown");
      assert(
        workers.length > 0,
        "positive control: the run must have created at least one worker",
      );
      for (const worker of workers) {
        assert(
          terminate.terminated.has(worker),
          "every worker must be terminated after a rejected generation",
        );
      }
      assert(
        seededCacheSize > 0,
        "positive control: seeding must populate the distance cache",
      );
      assertPopulationDisposed(population, creature);
      assertEquals(
        getDistanceCacheSize(),
        0,
        "the distance cache must be released after a rejected generation",
      );
      assert(
        sigterm.adds > 0,
        "positive control: evolveDir must register a SIGTERM listener",
      );
      assertEquals(
        sigterm.live.size,
        0,
        "no SIGTERM listener may outlive a rejected generation",
      );
      assertCallerUsable(creature);

      const second = await evolveDir(creature, dataSetDir, {
        populationSize: 6,
        iterations: 2,
        timeoutMinutes: TIMEOUT_MINUTES,
        threads: 1,
        creatureStore,
        logger: silentLogger,
      }, { startTimeMS: START_MS, now: () => START_MS });

      assert(
        Number.isFinite(second.score),
        "a fresh run after a failure must complete with a finite score",
      );
      assertEquals(
        sigterm.live.size,
        0,
        "the second run must leave no SIGTERM listener behind",
      );
    } finally {
      sigterm.restore();
      terminate.restore();
      setLogger(priorLogger);
      await Deno.remove(dataSetDir, { recursive: true });
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "evolveDir: a cleanup error is logged and never replaces the original rejection (Issue #4072)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({ prefix: "neat-4072-log-" });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const failure = new Error("boom");
    const priorLogger = getLogger();
    const sigterm = watchSigterm();
    const terminate = failingTerminate();
    const loggedErrors: unknown[][] = [];
    const capturingLogger: Logger = {
      debug: (..._args: unknown[]) => {},
      info: (..._args: unknown[]) => {},
      warn: (..._args: unknown[]) => {},
      error: (...args: unknown[]) => {
        loggedErrors.push(args);
      },
    };

    try {
      const counter = { calls: 0 };
      const deps: EvolveDirDeps = {
        startTimeMS: START_MS,
        now: () => START_MS,
        onNeatReady: (neat) => rejectEvolve(neat, failure, counter),
      };

      let caught: unknown;
      try {
        await evolveDir(creature, dataSetDir, {
          populationSize: 6,
          iterations: 500,
          timeoutMinutes: TIMEOUT_MINUTES,
          threads: 1,
          creatureStore,
          logger: capturingLogger,
        }, deps);
      } catch (error) {
        caught = error;
      }

      assertEquals(counter.calls, 1, "generation 1 must be entered once");
      assertEquals(
        caught,
        failure,
        "a cleanup error must never replace the original rejection",
      );
      assert(
        terminate.calls > 0,
        "positive control: the failing terminate must have been reached",
      );
      assert(
        loggedErrors.some((args) =>
          typeof args[0] === "string" &&
          args[0].includes("cleanup failed after error")
        ),
        "a cleanup error must be logged with 'cleanup failed after error'",
      );
      assertEquals(
        sigterm.live.size,
        0,
        "the remaining cleanup must still remove the SIGTERM listener",
      );
    } finally {
      terminate.restore();
      sigterm.restore();
      setLogger(priorLogger);
      await Deno.remove(dataSetDir, { recursive: true });
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "evolveEnv: a rejected generation removes its SIGTERM and abort listeners, and a second run starts clean (Issue #4072)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const creatureStore = await Deno.makeTempDir({ prefix: "neat-4072-env-" });
    const creature = new Creature(1, 1, { layers: [{ count: 3 }] });
    const failure = new Error("boom");
    const priorLogger = getLogger();
    const controller = new AbortController();
    const sigterm = watchSigterm();
    const abort = watchAbort(controller.signal);

    try {
      let population: Creature[] = [];
      let seededCacheSize = 0;
      const counter = { calls: 0 };
      const deps: EvolveDirDeps = {
        startTimeMS: START_MS,
        now: () => START_MS,
        onNeatReady: (neat) => {
          population = [...neat.population];
          seededCacheSize = seedDistanceCache();
          rejectEvolve(neat, failure, counter);
        },
      };

      let caught: unknown;
      try {
        await evolveEnv(creature, buildEnvAdapter(), {
          populationSize: 6,
          iterations: 500,
          timeoutMinutes: TIMEOUT_MINUTES,
          threads: 1,
          creatureStore,
          logger: silentLogger,
          signal: controller.signal,
        }, deps);
      } catch (error) {
        caught = error;
      }

      assertEquals(counter.calls, 1, "generation 1 must be entered once");
      assertEquals(caught, failure, "the original rejection must be rethrown");
      assert(
        seededCacheSize > 0,
        "positive control: seeding must populate the distance cache",
      );
      assertPopulationDisposed(population, creature);
      assertEquals(
        getDistanceCacheSize(),
        0,
        "the distance cache must be released after a rejected generation",
      );
      assert(
        sigterm.adds > 0,
        "positive control: evolveEnv must register a SIGTERM listener",
      );
      assertEquals(
        sigterm.live.size,
        0,
        "no SIGTERM listener may outlive a rejected generation",
      );
      assert(
        abort.adds > 0,
        "positive control: evolveEnv must register an abort listener",
      );
      assertEquals(
        abort.live.size,
        0,
        "no abort listener may outlive a rejected generation",
      );
      assertCallerUsable(creature);

      const second = await evolveEnv(creature, buildEnvAdapter(), {
        populationSize: 6,
        iterations: 2,
        timeoutMinutes: TIMEOUT_MINUTES,
        threads: 1,
        creatureStore,
        logger: silentLogger,
        signal: controller.signal,
      }, { startTimeMS: START_MS, now: () => START_MS });

      assert(
        Number.isFinite(second.score),
        "a fresh run after a failure must complete with a finite score",
      );
      assertEquals(
        sigterm.live.size,
        0,
        "the second run must leave no SIGTERM listener behind",
      );
      assertEquals(
        abort.live.size,
        0,
        "the second run must leave no abort listener behind",
      );
    } finally {
      abort.restore();
      sigterm.restore();
      setLogger(priorLogger);
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "evolveRL: a rejected generation removes its SIGTERM and abort listeners, and a second run starts clean (Issue #4072)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const creatureStore = await Deno.makeTempDir({ prefix: "neat-4072-rl-" });
    const creature = new Creature(1, 1, { layers: [{ count: 3 }] });
    const failure = new Error("boom");
    const priorLogger = getLogger();
    const controller = new AbortController();
    const sigterm = watchSigterm();
    const abort = watchAbort(controller.signal);

    try {
      let population: Creature[] = [];
      let seededCacheSize = 0;
      const counter = { calls: 0 };
      const deps: EvolveDirDeps = {
        startTimeMS: START_MS,
        now: () => START_MS,
        onNeatReady: (neat) => {
          population = [...neat.population];
          seededCacheSize = seedDistanceCache();
          rejectEvolve(neat, failure, counter);
        },
      };

      let caught: unknown;
      try {
        await evolveRL(creature, new UnreachableAdapter(), {
          populationSize: 6,
          iterations: 500,
          timeoutMinutes: TIMEOUT_MINUTES,
          threads: 1,
          creatureStore,
          logger: silentLogger,
          signal: controller.signal,
        }, deps);
      } catch (error) {
        caught = error;
      }

      assertEquals(counter.calls, 1, "generation 1 must be entered once");
      assertEquals(caught, failure, "the original rejection must be rethrown");
      assert(
        seededCacheSize > 0,
        "positive control: seeding must populate the distance cache",
      );
      assertPopulationDisposed(population, creature);
      assertEquals(
        getDistanceCacheSize(),
        0,
        "the distance cache must be released after a rejected generation",
      );
      assert(
        sigterm.adds > 0,
        "positive control: evolveRL must register a SIGTERM listener",
      );
      assertEquals(
        sigterm.live.size,
        0,
        "no SIGTERM listener may outlive a rejected generation",
      );
      assert(
        abort.adds > 0,
        "positive control: evolveRL must register an abort listener",
      );
      assertEquals(
        abort.live.size,
        0,
        "no abort listener may outlive a rejected generation",
      );
      assertCallerUsable(creature);

      const second = await evolveRL(creature, new UnreachableAdapter(), {
        populationSize: 6,
        iterations: 2,
        timeoutMinutes: TIMEOUT_MINUTES,
        threads: 1,
        creatureStore,
        logger: silentLogger,
        signal: controller.signal,
      }, { startTimeMS: START_MS, now: () => START_MS });

      assert(
        Number.isFinite(second.score),
        "a fresh run after a failure must complete with a finite score",
      );
      assertEquals(
        sigterm.live.size,
        0,
        "the second run must leave no SIGTERM listener behind",
      );
      assertEquals(
        abort.live.size,
        0,
        "the second run must leave no abort listener behind",
      );
    } finally {
      abort.restore();
      sigterm.restore();
      setLogger(priorLogger);
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "evolveRL: a rejected generation terminates its episode worker pool (Issue #4072)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const creatureStore = await Deno.makeTempDir({ prefix: "neat-4072-pool-" });
    const creature = new Creature(1, 1, { layers: [{ count: 3 }] });
    const failure = new Error("boom");
    const pools = watchEpisodeWorkerPool();

    try {
      const counter = { calls: 0 };
      const deps: EvolveDirDeps = {
        startTimeMS: START_MS,
        now: () => START_MS,
        onNeatReady: (neat) => rejectEvolve(neat, failure, counter),
      };

      let caught: unknown;
      try {
        await evolveRL(creature, new SeedRewardAdapterFixture(), {
          populationSize: 6,
          iterations: 500,
          timeoutMinutes: TIMEOUT_MINUTES,
          threads: 2,
          creatureStore,
          logger: silentLogger,
          adapterDescription: { url: SEED_REWARD_FIXTURE_URL, direct: true },
        }, deps);
      } catch (error) {
        caught = error;
      }

      assertEquals(counter.calls, 1, "generation 1 must be entered once");
      assertEquals(caught, failure, "the original rejection must be rethrown");
      assert(
        pools.creations >= 1,
        "positive control: evolveRL must create an episode worker pool",
      );
      assert(
        pools.terminations >= 1,
        "the episode worker pool must be terminated after a rejected generation",
      );
    } finally {
      pools.restore();
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "evolveDir: a rejection after a champion exists disposes the champion (Issue #4072)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({
      prefix: "neat-4072-champ-dir-",
    });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const failure = new Error("boom");
    const priorLogger = getLogger();
    const ledger: ChampionLedger = { calls: 0, championNeurons: 0 };

    try {
      const deps: EvolveDirDeps = {
        startTimeMS: START_MS,
        now: () => START_MS,
        onNeatReady: (neat) => rejectAfterChampion(neat, failure, ledger),
      };

      let caught: unknown;
      try {
        await evolveDir(creature, dataSetDir, {
          populationSize: 6,
          iterations: 500,
          timeoutMinutes: TIMEOUT_MINUTES,
          threads: 1,
          creatureStore,
          logger: silentLogger,
        }, deps);
      } catch (error) {
        caught = error;
      }

      assertEquals(caught, failure, "the original rejection must be rethrown");
      assertChampionDisposed(ledger);
    } finally {
      setLogger(priorLogger);
      await Deno.remove(dataSetDir, { recursive: true });
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "evolveEnv: a rejection after a champion exists disposes the champion (Issue #4072)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const creatureStore = await Deno.makeTempDir({
      prefix: "neat-4072-champ-env-",
    });
    const creature = new Creature(1, 1, { layers: [{ count: 3 }] });
    const failure = new Error("boom");
    const priorLogger = getLogger();
    const ledger: ChampionLedger = { calls: 0, championNeurons: 0 };

    try {
      const deps: EvolveDirDeps = {
        startTimeMS: START_MS,
        now: () => START_MS,
        onNeatReady: (neat) => rejectAfterChampion(neat, failure, ledger),
      };

      let caught: unknown;
      try {
        await evolveEnv(creature, buildEnvAdapter(), {
          populationSize: 6,
          iterations: 500,
          timeoutMinutes: TIMEOUT_MINUTES,
          threads: 1,
          creatureStore,
          logger: silentLogger,
        }, deps);
      } catch (error) {
        caught = error;
      }

      assertEquals(caught, failure, "the original rejection must be rethrown");
      assertChampionDisposed(ledger);
    } finally {
      setLogger(priorLogger);
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "evolveRL: a rejection after a champion exists disposes the champion (Issue #4072)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const creatureStore = await Deno.makeTempDir({
      prefix: "neat-4072-champ-rl-",
    });
    const creature = new Creature(1, 1, { layers: [{ count: 3 }] });
    const failure = new Error("boom");
    const priorLogger = getLogger();
    const ledger: ChampionLedger = { calls: 0, championNeurons: 0 };

    try {
      const deps: EvolveDirDeps = {
        startTimeMS: START_MS,
        now: () => START_MS,
        onNeatReady: (neat) => rejectAfterChampion(neat, failure, ledger),
      };

      let caught: unknown;
      try {
        await evolveRL(creature, new UnreachableAdapter(), {
          populationSize: 6,
          iterations: 500,
          timeoutMinutes: TIMEOUT_MINUTES,
          threads: 1,
          creatureStore,
          logger: silentLogger,
        }, deps);
      } catch (error) {
        caught = error;
      }

      assertEquals(caught, failure, "the original rejection must be rethrown");
      assertChampionDisposed(ledger);
    } finally {
      setLogger(priorLogger);
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});

/** Records every message a logger receives, at any level (Issue #4072). */
interface CaptureLedger {
  messages: string[];
  logger: Logger;
}

function captureLogger(): CaptureLedger {
  const messages: string[] = [];
  const record = (...args: unknown[]): void => {
    messages.push(args.map((arg) => String(arg)).join(" "));
  };
  return {
    messages,
    logger: { debug: record, info: record, warn: record, error: record },
  };
}

/** A successful run must never log a teardown step that threw (Issue #4072). */
function assertNoCleanupFailure(messages: string[]): void {
  assertEquals(
    messages.filter((message) =>
      message.includes("cleanup failed after error")
    ),
    [],
    "a successful run must not log a cleanup failure",
  );
}

Deno.test({
  name:
    "evolveDir: a successful run logs no cleanup failure and leaves the caller usable (Issue #4072)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const dataSetDir = makeDataDir(tinyDataSet(), 2000);
    const creatureStore = await Deno.makeTempDir({
      prefix: "neat-4072-ok-dir-",
    });
    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const priorLogger = getLogger();
    const capture = captureLogger();

    try {
      const result = await evolveDir(creature, dataSetDir, {
        populationSize: 6,
        iterations: 2,
        timeoutMinutes: TIMEOUT_MINUTES,
        threads: 1,
        creatureStore,
        logger: capture.logger,
      }, { startTimeMS: START_MS, now: () => START_MS });

      assert(
        Number.isFinite(result.score),
        "a successful run must complete with a finite score",
      );
      assertNoCleanupFailure(capture.messages);
      assertEvolveCallerUsable(creature, "evolveDir");
      assertCallerUsable(creature);
    } finally {
      setLogger(priorLogger);
      await Deno.remove(dataSetDir, { recursive: true });
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "evolveEnv: a successful run logs no cleanup failure and leaves the caller usable (Issue #4072)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const creatureStore = await Deno.makeTempDir({
      prefix: "neat-4072-ok-env-",
    });
    const creature = new Creature(1, 1, { layers: [{ count: 3 }] });
    const priorLogger = getLogger();
    const capture = captureLogger();

    try {
      await evolveEnv(creature, buildEnvAdapter(), {
        populationSize: 6,
        iterations: 2,
        timeoutMinutes: TIMEOUT_MINUTES,
        threads: 1,
        creatureStore,
        logger: capture.logger,
      }, { startTimeMS: START_MS, now: () => START_MS });

      assertNoCleanupFailure(capture.messages);
      assertEvolveCallerUsable(creature, "evolveEnv");
      assertCallerUsable(creature);
    } finally {
      setLogger(priorLogger);
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "evolveRL: a successful run logs no cleanup failure, terminates its episode worker pool exactly once, and leaves the caller usable (Issue #4072)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();

    const creatureStore = await Deno.makeTempDir({
      prefix: "neat-4072-ok-rl-",
    });
    const creature = new Creature(1, 1, { layers: [{ count: 3 }] });
    const priorLogger = getLogger();
    const capture = captureLogger();
    const pools = watchEpisodeWorkerPool();

    try {
      await evolveRL(creature, new SeedRewardAdapterFixture(), {
        populationSize: 6,
        iterations: 2,
        timeoutMinutes: TIMEOUT_MINUTES,
        threads: 2,
        creatureStore,
        logger: capture.logger,
        adapterDescription: { url: SEED_REWARD_FIXTURE_URL, direct: true },
      }, { startTimeMS: START_MS, now: () => START_MS });

      assert(
        pools.creations >= 1,
        "positive control: evolveRL must create an episode worker pool",
      );
      assertEquals(
        pools.terminations,
        pools.creations,
        "every episode worker pool must be terminated exactly once",
      );
      assertNoCleanupFailure(capture.messages);
      assertEvolveCallerUsable(creature, "evolveRL");
      assertCallerUsable(creature);
    } finally {
      pools.restore();
      setLogger(priorLogger);
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});
