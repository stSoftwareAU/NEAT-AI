import { assert, assertEquals } from "@std/assert";
import {
  evolveDir,
  evolveEnv,
  evolveRL,
} from "../../src/creature/CreatureTraining.ts";

/**
 * Issue #4060: a generation-1 `neat.evolve()` that blocks the main thread
 * synchronously must still end at the first-generation bound with
 * `first-generation-wedged`.
 *
 * Issue #4053 bounded generation 1 with `awaitWithinHardDeadline`, a
 * `setInterval` poll on the same event loop as the work it bounds. The test
 * added then (`EvolveDirFirstGenerationWedged.ts`) stubbed `evolve` with a
 * never-settling promise, which yields the event loop, so the poll ran and the
 * bound fired. It could not catch the real failure: with `threads: 1` training
 * runs in-process and blocks the thread, the poll never gets a turn, and the
 * run hangs silently for hours.
 *
 * Here the stubbed `evolve` spins in a synchronous `for (;;)`. The off-thread
 * watchdog (a Deno Worker) must log the wedge and SIGKILL the process. That
 * kills the process, so each entry point runs in a child process. The entry
 * points are imported here too, so a rename breaks this test at compile time.
 */

const GUARD_MS = 60_000;

interface ChildResult {
  guardFired: boolean;
  success: boolean;
  signal: Deno.Signal | null;
  stdout: string;
  stderr: string;
}

const PROLOGUE = `
import { Creature } from "@creature";
import { initWasmActivation } from "@wasm/mod.ts";
await initWasmActivation();
const deps = {
  startTimeMS: Date.now() - 24 * 60 * 60_000,
  firstGenerationWatchdogSlackMS: 0,
  teardownBudgetMS: 1_000,
  onNeatReady: (neat) => {
    neat.evolve = () => {
      for (;;) { /* block the event loop */ }
    };
  },
};
`;

function options(store: string): string {
  return `{
  populationSize: 6,
  iterations: 500,
  timeoutMinutes: 5,
  threads: 1,
  creatureStore: ${JSON.stringify(store)},
}`;
}

function evolveDirCode(store: string): string {
  return `${PROLOGUE}
import { evolveDir } from "./src/creature/CreatureTraining.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
const dataSetDir = makeDataDir([
  { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
  { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
  { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
  { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
], 2000);
console.log("DATASET_DIR=" + dataSetDir);
await evolveDir(new Creature(2, 1, { layers: [{ count: 3 }] }), dataSetDir, ${
    options(store)
  }, deps);
console.log("EVOLVE_RETURNED");
`;
}

function evolveEnvCode(store: string): string {
  return `${PROLOGUE}
import { evolveEnv } from "./src/creature/CreatureTraining.ts";
const adapter = {
  inputCount: 1,
  outputCount: 1,
  maxSteps: 1,
  reset(_seed) { return null; },
  observe(_state) { return new Float32Array([1.0]); },
  decode(output) { return output[0]; },
  step(_state, action) {
    return { state: null, reward: -Math.abs(action - 99), done: true };
  },
};
await evolveEnv(new Creature(1, 1), adapter, ${options(store)}, deps);
console.log("EVOLVE_RETURNED");
`;
}

function evolveRLCode(store: string): string {
  return `${PROLOGUE}
import { evolveRL } from "./src/creature/CreatureTraining.ts";
import { EpisodeAdapter } from "@creature/EpisodeAdapter.ts";
class UnreachableAdapter extends EpisodeAdapter {
  reset(_seed) { return { observation: new Float32Array([1.0]), state: null }; }
  step(_state, action) {
    return {
      observation: new Float32Array([0]),
      reward: -Math.abs(action - 99),
      terminated: true,
      truncated: false,
      state: null,
    };
  }
  get observationLength() { return 1; }
  decodeAction(creatureOutput) { return creatureOutput[0]; }
  maxSteps() { return 1; }
}
const rlOptions = ${options(store).replace(/\}$/, "")}
  episodesPerCreature: 1,
  seed: 7,
};
await evolveRL(new Creature(1, 1), new UnreachableAdapter(), rlOptions, deps);
console.log("EVOLVE_RETURNED");
`;
}

async function runChild(
  build: (store: string) => string,
): Promise<ChildResult> {
  const store = await Deno.makeTempDir({ prefix: "neat-4060-" });
  try {
    const env: Record<string, string> = {};
    for (const key of ["PATH", "HOME", "DENO_DIR", "TMPDIR"]) {
      const value = Deno.env.get(key);
      if (value !== undefined) env[key] = value;
    }
    const child = new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config", "./deno.json", build(store)],
      env,
      clearEnv: true,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).spawn();

    let guardFired = false;
    const guard = setTimeout(() => {
      guardFired = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    }, GUARD_MS);
    const output = await child.output();
    clearTimeout(guard);
    const decoder = new TextDecoder();
    const stdout = decoder.decode(output.stdout);
    // The child is SIGKILLed, so it cannot remove its own dataset directory.
    const match = stdout.match(/^DATASET_DIR=(.+)$/m);
    if (match) {
      try {
        await Deno.remove(match[1], { recursive: true });
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
      }
    }
    return {
      guardFired,
      success: output.success,
      signal: output.signal,
      stdout,
      stderr: decoder.decode(output.stderr),
    };
  } finally {
    await Deno.remove(store, { recursive: true });
  }
}

const children = [
  { entry: evolveDir, result: runChild(evolveDirCode) },
  { entry: evolveEnv, result: runChild(evolveEnvCode) },
  { entry: evolveRL, result: runChild(evolveRLCode) },
];

function check(r: ChildResult) {
  const detail = `\nstderr:\n${r.stderr}\nstdout:\n${r.stdout}`;
  assert(
    !r.guardFired,
    `child never terminated — the first-generation bound did not fire on a blocked event loop${detail}`,
  );
  assertEquals(r.success, false, `child must not exit cleanly${detail}`);
  assertEquals(r.signal, "SIGKILL", `child must be SIGKILLed${detail}`);
  assert(
    r.stderr.includes("[Neat] First generation wedged after"),
    `missing wedged log line${detail}`,
  );
  assert(
    r.stderr.includes("main thread was not yielding"),
    `missing cause in log line${detail}`,
  );
  assert(
    r.stderr.includes("first-generation-wedged"),
    `missing termination reason${detail}`,
  );
  assert(
    !r.stdout.includes("EVOLVE_RETURNED"),
    `evolve must never return${detail}`,
  );
}

for (const { entry, result } of children) {
  Deno.test({
    name:
      `${entry.name}: a blocked main thread still ends at the first-generation bound`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      check(await result);
    },
  });
}
