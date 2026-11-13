/**
 * `nativeBackpropTrainAsync` awaits a non-blocking native trainer call
 * (Issue #4126).
 *
 * A synchronous FFI call parks a worker thread inside native code.
 * `Worker.terminate()` cannot stop that thread, so the process stays alive
 * after `evolveDir` has returned. A `nonblocking: true` call runs on its own
 * native thread and returns a promise, so the worker can terminate and the
 * process can exit.
 *
 * Stand-ins: the real `libneat_ai_backpropagation` is not available in CI, so
 * the unit cases use C ABI doubles that return a promise and read/write the
 * C-heap pointers the module hands them. The process-level cases use the C
 * library `sleep`, declared with the `nonblocking` flag taken from the real
 * `NATIVE_BACKPROP_SYMBOLS`, to pin the process-exit property of that
 * declaration. The control (`nonblocking: false`) proves the stand-in can
 * detect a hang: its short watchdog is armed only after the child printed its
 * last statement, so start-up latency cannot decide the outcome. The watchdogs
 * bound a hang; they are not measurements.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  __installNativeBackpropLibraryForTests,
  closeNativeBackpropLibrary,
  NATIVE_BACKPROP_SYMBOLS,
  type NativeBackpropHandle,
  nativeBackpropTrainAsync,
  type NativeBackpropTrainRequest,
} from "@architecture/training/NativeBackpropLibrary.ts";

const CAPABILITIES = JSON.stringify({
  abiVersion: 1,
  version: "0.1.50",
  capabilities: {
    deadline: {
      version: 1,
      requestField: "deadlineEpochMs",
      cliFlag: "--deadline-epoch-ms",
      unit: "epochMilliseconds",
      resultFile: "result.json",
    },
  },
});

const COMPLETED_RESPONSE = JSON.stringify({
  abiVersion: 1,
  version: "0.1.50",
  bestCreatureJson: "{}",
  baselineMse: 0.5,
  bestMse: 0.25,
  acceptedEpochs: 1,
  epochs: 1,
  bestPath: "best.json",
  journalPath: "journal.json",
  timedOut: false,
  timeout: null,
  completedEpochs: 1,
  baselineMeasure: { kind: "full", mse: 0.5, records: 10 },
  bestMeasure: { kind: "full", mse: 0.25, records: 10 },
});

// Keeps payloads reachable while a double's "native" side points at them.
const keepAlive: Uint8Array[] = [];

function trainRequest(
  extra: Partial<NativeBackpropTrainRequest> = {},
): NativeBackpropTrainRequest {
  return {
    creatureJson: "{}",
    trainingData: "/nonexistent/training",
    outputDir: "/nonexistent/output",
    epochs: 1,
    seed: 1,
    disableRandomSamples: true,
    learningRate: 0.01,
    learningRateStrategy: "fixed",
    learningRateDecay: 0,
    normaliseGradients: false,
    maximumBiasAdjustmentScale: 1,
    maximumWeightAdjustmentScale: 1,
    stepScale: 0.01,
    ...extra,
  };
}

/**
 * A handle double. `capabilities` omitted means a legacy library. With
 * `withAlias` false the non-blocking symbol is absent.
 */
function makeDouble(options: {
  capabilities?: string;
  withAlias?: boolean;
  status: number;
  payload: string;
}): {
  handle: NativeBackpropHandle;
  received: Record<string, unknown>[];
  syncCalls: number[];
} {
  const received: Record<string, unknown>[] = [];
  const syncCalls: number[] = [];
  const capabilityBytes = options.capabilities === undefined
    ? null
    : new TextEncoder().encode(`${options.capabilities}\0`);
  if (capabilityBytes !== null) keepAlive.push(capabilityBytes);

  const symbols: Record<string, unknown> = {
    "neat_backprop_abi_version": () => 1,
    "neat_backprop_version": () => null,
    "neat_backprop_capabilities": capabilityBytes === null
      ? null
      : () => Deno.UnsafePointer.of(capabilityBytes),
    "neat_backprop_train": () => {
      syncCalls.push(1);
      return 0;
    },
    "neat_backprop_buffer_free": () => {},
  };
  if (options.withAlias !== false) {
    symbols["neat_backprop_train_nonblocking"] = (
      reqPtr: Deno.PointerObject,
      len: bigint,
      outPtr: Deno.PointerObject,
    ): Promise<number> => {
      const bytes = new Uint8Array(Number(len));
      new Deno.UnsafePointerView(reqPtr).copyInto(bytes);
      received.push(JSON.parse(new TextDecoder().decode(bytes)));
      const payload = new TextEncoder().encode(options.payload);
      keepAlive.push(payload);
      const view = new DataView(
        Deno.UnsafePointerView.getArrayBuffer(outPtr, 24),
      );
      view.setBigUint64(
        0,
        Deno.UnsafePointer.value(Deno.UnsafePointer.of(payload)),
        true,
      );
      view.setBigUint64(8, BigInt(payload.byteLength), true);
      view.setBigUint64(16, BigInt(payload.byteLength), true);
      return Promise.resolve(options.status);
    };
  }
  return {
    handle: { symbols, close: () => {} } as unknown as NativeBackpropHandle,
    received,
    syncCalls,
  };
}

Deno.test("nativeBackpropTrainAsync awaits the non-blocking call and forwards the deadline", async () => {
  const deadline = 1_800_000_000_000;
  const { handle, received, syncCalls } = makeDouble({
    capabilities: CAPABILITIES,
    status: 0,
    payload: COMPLETED_RESPONSE,
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    const response = await nativeBackpropTrainAsync(
      trainRequest({ deadlineEpochMs: deadline }),
    );
    assertEquals(response.bestMse, 0.25);
    assertEquals(response.timedOut, false);
    assertEquals(received.length, 1);
    assertEquals(received[0].deadlineEpochMs, deadline);
    assertEquals(syncCalls.length, 0);
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("nativeBackpropTrainAsync rejects with the native error on a non-OK status", async () => {
  const { handle } = makeDouble({
    capabilities: CAPABILITIES,
    status: 2,
    payload: "boom: trainer failed",
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    const error = await nativeBackpropTrainAsync(trainRequest()).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    assert(error !== undefined, "expected a rejection");
    assertStringIncludes(
      error.message,
      "neat_backprop_train failed (status 2)",
    );
    assertStringIncludes(error.message, "boom: trainer failed");
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("nativeBackpropTrainAsync refuses a deadline on a legacy library before any native call", async () => {
  const { handle, received, syncCalls } = makeDouble({
    status: 0,
    payload: COMPLETED_RESPONSE,
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    const error = await nativeBackpropTrainAsync(
      trainRequest({ deadlineEpochMs: 1_800_000_000_000 }),
    ).then(() => undefined, (e: unknown) => e as Error);
    assert(error !== undefined, "expected a rejection");
    assertStringIncludes(error.message, "no deadline capability");
    assertEquals(received.length, 0);
    assertEquals(syncCalls.length, 0);
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("nativeBackpropTrainAsync rejects when the handle lacks the non-blocking symbol", async () => {
  const { handle } = makeDouble({
    capabilities: CAPABILITIES,
    withAlias: false,
    status: 0,
    payload: COMPLETED_RESPONSE,
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    const error = await nativeBackpropTrainAsync(trainRequest()).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    assert(error !== undefined, "expected a rejection");
    assertStringIncludes(error.message, "neat_backprop_train_nonblocking");
  } finally {
    closeNativeBackpropLibrary();
  }
});

// --- process-level: terminating a worker blocked in a native call -----------

/** Stdout marker the child prints once the caller's last statement has run. */
const LAST_STATEMENT = "CALLER_LAST_STATEMENT";
/** Watchdog for a child expected to exit on its own (also the fallback). */
const EXIT_WATCHDOG_MS = 30_000;
/** Control watchdog, armed once the child has printed its last statement. */
const CONTROL_WATCHDOG_MS = 2_000;
/** How long the wedged worker sleeps. The exit must not wait for it. */
const WORKER_SLEEP_SECONDS = 120;

// cspell:disable-next-line
const LIBC = Deno.build.os === "darwin" ? "libSystem.B.dylib" : "libc.so.6";

const REPO_ROOT = new URL("../../../", import.meta.url);
const REPO_CONFIG = fromFileUrl(new URL("deno.json", REPO_ROOT));

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

function childSource(): string {
  const libraryUrl = new URL(
    "src/architecture/training/NativeBackpropLibrary.ts",
    REPO_ROOT,
  ).href;
  return `import { NATIVE_BACKPROP_SYMBOLS } from ${JSON.stringify(libraryUrl)};

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
  nonblocking: NATIVE_BACKPROP_SYMBOLS.neat_backprop_train_nonblocking.nonblocking,
});
await started;
worker.terminate();
console.log("${LAST_STATEMENT}");
`;
}

async function writeFixtures(
  dir: string,
  nonblocking: "fromMessage" | false,
): Promise<string> {
  await Deno.writeTextFile(join(dir, "worker.ts"), workerSource(nonblocking));
  const childPath = join(dir, "child.ts");
  await Deno.writeTextFile(childPath, childSource());
  return childPath;
}

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
  code: number;
  success: boolean;
  /** True when the watchdog fired, i.e. the child did not exit on its own. */
  killedByWatchdog: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run the child until it exits or the watchdog kills it. With `controlMS` the
 * watchdog is re-armed to that bound once the child prints its last statement.
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
      args: ["run", "-A", "--no-lock", "--config", REPO_CONFIG, childPath],
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
    "a worker in the non-blocking neat_backprop_train declaration does not keep the process alive after terminate (Issue #4126)",
  ignore: SKIP_WINDOWS,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "backprop-exit-" });
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
    const dir = await Deno.makeTempDir({ prefix: "backprop-control-" });
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

Deno.test("NATIVE_BACKPROP_SYMBOLS aliases neat_backprop_train as non-blocking only for the async entry", () => {
  const alias = NATIVE_BACKPROP_SYMBOLS.neat_backprop_train_nonblocking;
  assertEquals(alias.name, "neat_backprop_train");
  assertEquals(alias.nonblocking, true);
  assertEquals(NATIVE_BACKPROP_SYMBOLS.neat_backprop_train.nonblocking, false);
});
