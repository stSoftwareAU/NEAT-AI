/**
 * The `analyze_parallel` FFI call is non-blocking, and the analysis path awaits
 * it (Issue #4126).
 *
 * A synchronous FFI call parks a worker thread inside native code. When the
 * analysis is abandoned at its deadline, `Worker.terminate()` cannot stop that
 * thread, so the process stays alive after `evolveDir` has returned. A
 * `nonblocking: true` call runs on its own native thread and returns a promise,
 * which lets the worker terminate and the process exit.
 *
 * Deno FFI documents that a symbol declared `nonblocking: true` runs on a separate
 * thread and returns a promise, whereas a blocking call parks the calling thread
 * (https://docs.deno.com/runtime/reference/deno_namespace_apis/#deno.dlopen). The
 * libc `sleep` stand-in mirrors that contract. It cannot exercise NEAT-AI-Discovery's
 * real `analyze_parallel`: the library is not available in CI, and the real-library
 * discovery tests in `test/discovery` are gated on it. The stand-in therefore pins
 * the process-exit property of the declaration `RUST_DISCOVERY_SYMBOLS` ships.
 *
 * Process-level cases: each child runs under an abort signal that kills it. That
 * is a watchdog bounding a hang, not a measurement. The assertions are binary:
 * the child exited by itself with code 0, or it was still running when the
 * watchdog fired. The control arms its short watchdog only after the child has
 * printed its last statement, so start-up latency (the child is compiled on each
 * run, and that time can vary) cannot make the control pass or fail for the
 * wrong reason. A fallback watchdog from spawn stops a child that never reaches
 * that statement from hanging the suite.
 *
 * Analysis cases call `ensureRustCombinedAnalysis` with a mocked
 * `analyzeParallel` that returns a promise, so they run without the Rust library.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { DiscoverStructureDeps } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  buildCombinedAnalysisKey,
  ensureRustCombinedAnalysis,
} from "@architecture/ErrorGuidedStructuralEvolution/RustAnalysisCache.ts";
import type {
  RustCandidateSynapse,
  RustParallelAnalysisResult,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** Stdout marker the child prints once the caller's last statement has run. */
const LAST_STATEMENT = "CALLER_LAST_STATEMENT";
/** Watchdog for a child expected to exit on its own (also the fallback). */
const EXIT_WATCHDOG_MS = 30_000;
/** Control watchdog, armed once the child has printed its last statement. */
const CONTROL_WATCHDOG_MS = 2_000;
/** How long the wedged worker sleeps. The exit must not wait for it. */
const WORKER_SLEEP_SECONDS = 120;
/** Parquet path handed to the analysis; the analysis is mocked, so it is unread. */
const PARQUET_FILE = "analysis-non-blocking.parquet";

// cspell:disable-next-line
const LIBC = Deno.build.os === "darwin" ? "libSystem.B.dylib" : "libc.so.6";

const REPO_ROOT = new URL("../../", import.meta.url);
const REPO_CONFIG = fromFileUrl(new URL("deno.json", REPO_ROOT));

function repoModule(relative: string): string {
  return new URL(relative, REPO_ROOT).href;
}

/**
 * The worker waits for a start message, opens libc with the chosen `nonblocking`
 * flag, announces it started, then calls the C library `sleep`.
 *
 * `"fromMessage"` takes the flag from the message the caller sends.
 * `false` hard-codes a blocking declaration, which is the control.
 */
function workerSource(nonblocking: "fromMessage" | false): string {
  const flag = nonblocking === "fromMessage"
    ? "event.data.nonblocking"
    : "false";
  return `self.addEventListener("message", (event) => {
  const lib = Deno.dlopen(${JSON.stringify(LIBC)}, {
    sleep: { parameters: ["u32"], result: "u32", nonblocking: ${flag} },
  });
  self.postMessage({ started: true });
  lib.symbols.sleep(${WORKER_SLEEP_SECONDS});
});
`;
}

/**
 * The child: starts the worker, waits for it to announce it started, terminates
 * it, then prints its last statement. The worker is always sent the flag from
 * the real `RUST_DISCOVERY_SYMBOLS`, which the control ignores.
 */
function childSource(): string {
  return `import { RUST_DISCOVERY_SYMBOLS } from ${
    JSON.stringify(
      repoModule(
        "src/architecture/ErrorGuidedStructuralEvolution/RustDiscoveryLibrary.ts",
      ),
    )
  };

const worker = new Worker(new URL("./worker.ts", import.meta.url).href, {
  type: "module",
});
const started = new Promise<void>((resolve, reject) => {
  worker.addEventListener("message", (event) => {
    if ((event.data as { started?: boolean }).started === true) resolve();
  });
  worker.addEventListener("error", (event) => {
    reject(new Error("worker failed to start: " + event.message));
  });
});
worker.postMessage({
  nonblocking: RUST_DISCOVERY_SYMBOLS.analyze_parallel.nonblocking,
});
await started;
worker.terminate();
console.log("${LAST_STATEMENT}");
`;
}

/** Write the worker and child fixtures; returns the child's path. */
async function writeFixtures(
  dir: string,
  nonblocking: "fromMessage" | false,
): Promise<string> {
  await Deno.writeTextFile(join(dir, "worker.ts"), workerSource(nonblocking));
  const childPath = join(dir, "child.ts");
  await Deno.writeTextFile(childPath, childSource());
  return childPath;
}

/** Drain a child's output stream, reporting the text so far after each chunk. */
async function collect(
  stream: ReadableStream<Uint8Array>,
  onText?: (text: string) => void,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    text += decoder.decode(chunk, { stream: true });
    onText?.(text);
  }
  return text + decoder.decode();
}

interface ChildRun {
  /** The exit code the child reported (or whatever Deno recorded on a kill). */
  code: number;
  success: boolean;
  /** True when the watchdog fired, i.e. the child did not exit on its own. */
  killedByWatchdog: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run the child until it exits on its own or the watchdog kills it.
 *
 * The watchdog is armed at spawn with the fallback bound. When `controlMS` is
 * given it is re-armed to that bound as soon as the child prints its last
 * statement, so the control measures "still alive after the caller returned",
 * not "still alive after start-up".
 */
async function runChild(
  childPath: string,
  controlMS?: number,
): Promise<ChildRun> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => abort.abort(), ms);
  };
  let child: Deno.ChildProcess | undefined;
  let lastStatementSeen = false;
  try {
    child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        "--no-lock",
        "--config",
        REPO_CONFIG,
        childPath,
      ],
      stdout: "piped",
      stderr: "piped",
      signal: abort.signal,
    }).spawn();
    arm(EXIT_WATCHDOG_MS);
    const [status, stdout, stderr] = await Promise.all([
      child.status,
      collect(child.stdout, (text) => {
        if (controlMS === undefined || lastStatementSeen) return;
        if (text.includes(LAST_STATEMENT)) {
          lastStatementSeen = true;
          arm(controlMS);
        }
      }),
      collect(child.stderr),
    ]);
    return {
      code: status.code,
      success: status.success,
      killedByWatchdog: abort.signal.aborted,
      stdout,
      stderr,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    try {
      child?.kill("SIGKILL");
    } catch {
      // Already exited on its own: nothing left to kill.
    }
  }
}

const SKIP_WINDOWS = Deno.build.os === "windows";

Deno.test({
  name:
    "a worker blocked in the analyze_parallel FFI declaration does not keep the process alive after terminate (Issue #4126)",
  ignore: SKIP_WINDOWS,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "analyze-parallel-exit-" });
    try {
      const childPath = await writeFixtures(dir, "fromMessage");
      const run = await runChild(childPath);
      const output = `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`;
      assert(
        !run.killedByWatchdog,
        `child did not exit within ${EXIT_WATCHDOG_MS} ms; ${output}`,
      );
      assertEquals(run.code, 0, output);
      assertStringIncludes(run.stdout, LAST_STATEMENT, output);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "control: a worker blocked in a blocking FFI declaration keeps the process alive after terminate (Issue #4126)",
  ignore: SKIP_WINDOWS,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "analyze-parallel-control-" });
    try {
      const childPath = await writeFixtures(dir, false);
      const run = await runChild(childPath, CONTROL_WATCHDOG_MS);
      const output = `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`;
      assertStringIncludes(run.stdout, LAST_STATEMENT, output);
      assert(
        run.killedByWatchdog,
        `expected the process to still be alive ${CONTROL_WATCHDOG_MS} ms ` +
          `after its last statement, but it exited with code ${run.code}; ` +
          output,
      );
      assert(!run.success, output);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

/** Builds the minimal creature the analysis path needs: one output neuron. */
function makeCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: -0.25 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/** Deps with an `analyzeParallel` double; everything else is inert. */
function makeDeps(
  analyzeParallel: DiscoverStructureDeps["analyzeParallel"],
): DiscoverStructureDeps {
  return {
    isRustDiscoveryEnabled: () => true,
    isRustLibraryAvailable: () => true,
    recordDiscovery: () => ({ success: true, file: "chunk.parquet" }),
    mergeDiscoveryParquet: () => ({
      success: true,
      outputFile: "merged.parquet",
    }),
    analyzeParallel,
    readDiscoveryRecords: () => ({ success: true, records: [] }),
  };
}

Deno.test("ensureRustCombinedAnalysis awaits an asynchronous analyzeParallel (Issue #4126)", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  const output = creature.neurons.find((n) => n.type === "output");
  assert(output, "test creature must have an output neuron");
  const focusList = [output.id];

  const helpfulSynapse: RustCandidateSynapse = {
    fromNeuronUuid: "input-1",
    toNeuronUuid: "output-0",
    weight: 0.3,
    targetNeuronImpact: 1.0,
    expectedCreatureErrorReduction: 0,
    expectedCreatureScoreGain: 0.5,
    improvedCount: 5,
    totalCount: 10,
  };
  const parallel: RustParallelAnalysisResult = {
    success: true,
    helpfulSynapses: [helpfulSynapse],
  };
  const deps = makeDeps(() => Promise.resolve(parallel));

  const logged: { scope: string; reason: string }[] = [];
  const { result, cache } = await ensureRustCombinedAnalysis(
    creature,
    PARQUET_FILE,
    deps,
    undefined,
    undefined,
    focusList,
    true,
    false,
    (scope, _focusList, reason) => {
      logged.push({ scope, reason });
    },
  );

  assertEquals(
    logged,
    [],
    "a successful asynchronous analysis must not log an unavailable reason",
  );
  assert(
    result !== undefined,
    "the awaited analysis result must be converted, not the pending promise",
  );
  assertEquals(result.synapse?.helpfulSynapses?.length, 1);
  assert(cache !== undefined, "a successful analysis must populate the cache");
  assertEquals(cache.key, buildCombinedAnalysisKey(PARQUET_FILE, focusList));
  assert(
    cache.result === result,
    "the cache must hold the converted result it returned",
  );
});

Deno.test("ensureRustCombinedAnalysis logs the reason from an asynchronous analyzeParallel failure (Issue #4126)", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  const output = creature.neurons.find((n) => n.type === "output");
  assert(output, "test creature must have an output neuron");
  const focusList = [output.id];

  const failure: RustParallelAnalysisResult = { success: false, error: "boom" };
  const deps = makeDeps(() => Promise.resolve(failure));

  const logged: { scope: string; reason: string }[] = [];
  const { result } = await ensureRustCombinedAnalysis(
    creature,
    PARQUET_FILE,
    deps,
    undefined,
    undefined,
    focusList,
    true,
    false,
    (scope, _focusList, reason) => {
      logged.push({ scope, reason });
    },
  );

  assertEquals(result, undefined);
  assertEquals(logged, [{ scope: "synapse", reason: "boom" }]);
});
