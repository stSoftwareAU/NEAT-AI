/**
 * A quarantined worker wedged in native code must not pin the process (Issue
 * #4126).
 *
 * A worker quarantined while a task was unanswered can be blocked inside
 * synchronous FFI. `Worker.terminate()` cannot interrupt that thread, and Deno
 * keeps the process alive until the thread ends, so a caller whose `evolveDir`
 * has already returned would never exit. Each case runs the real bounded
 * teardown in a child process and checks whether that process exits on its own.
 *
 * Process-level controls: every child runs under an abort signal that kills it.
 * That is a watchdog bounding a hang, not a measurement. The assertions are
 * binary: the child exited by itself with code N, or it was still running when
 * the watchdog fired. Case 2 arms its short watchdog only after the child has
 * printed its last statement, so start-up latency (the child is type-checked on
 * each run) cannot make the control pass or fail for the wrong reason. A
 * fallback watchdog from spawn stops a child that never reaches that statement
 * from hanging the suite.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/** Stdout marker the child prints once the teardown has returned. */
const LAST_STATEMENT = "CALLER_LAST_STATEMENT";
/** Phrase the exit guard logs when a wedged worker would pin the process. */
const UNSTOPPABLE_NOTICE = "could not be stopped";
/** Watchdog for a child expected to exit on its own (also the fallback). */
const EXIT_WATCHDOG_MS = 30_000;
/** Control watchdog, armed once the child has printed its last statement. */
const CONTROL_WATCHDOG_MS = 2_000;
/** How long the wedged worker sleeps. The exit must not wait for it. */
const WORKER_SLEEP_SECONDS = 120;
/** Guard grace period passed to the teardown in the child. */
const GUARD_GRACE_MS = 500;

const LIBC = Deno.build.os === "darwin" ? "libSystem.B.dylib" : "libc.so.6";

const REPO_ROOT = new URL("../../", import.meta.url);
const REPO_CONFIG = fromFileUrl(new URL("deno.json", REPO_ROOT));

function repoModule(relative: string): string {
  return new URL(relative, REPO_ROOT).href;
}

/** The worker: announces it started, then blocks its thread in libc `sleep`. */
function workerSource(): string {
  return `const lib = Deno.dlopen(${JSON.stringify(LIBC)}, {
  sleep: { parameters: ["u32"], result: "u32" },
});
self.postMessage({ taskID: 0, started: true });
lib.symbols.sleep(${WORKER_SLEEP_SECONDS});
`;
}

/**
 * The child: quarantines a handler whose one task the wedged worker never
 * answers, runs the bounded teardown, then prints its last statement. Options
 * come from argv so one fixture serves every case.
 */
function childSource(): string {
  const imports = [
    `import { assert } from "@std/assert";`,
    `import type { WorkerInterface } from ${
      JSON.stringify(repoModule("src/workers/WorkerInterface.ts"))
    };`,
    `import { WorkerHandlerBase } from ${
      JSON.stringify(repoModule("src/workers/WorkerHandlerBase.ts"))
    };`,
    `import { runBoundedEvolveTeardown } from ${
      JSON.stringify(repoModule("src/creature/BoundedEvolveTeardown.ts"))
    };`,
  ];
  const body = `
interface Request {
  taskID: number;
}

interface Response {
  taskID: number;
  duration: number;
}

/** A training-style handler: one labelled task dispatched through makePromise. */
class WedgedHandler extends WorkerHandlerBase<Request, Response> {
  constructor(worker: WorkerInterface<Request>) {
    super(worker, Promise.resolve({ taskID: 0, duration: 0 }));
  }

  dispatch(): Promise<Response> {
    return this.makePromise({ taskID: 1 }, "task-1");
  }
}

function flag(name: string): string | undefined {
  const prefix = "--" + name + "=";
  return Deno.args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

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

const handler = new WedgedHandler(worker as unknown as WorkerInterface<Request>);
await started;

const settled = handler.dispatch().then(
  () => {
    throw new Error("task-1 resolved although its worker never answered");
  },
  () => undefined, // expected: the quarantine fails the unanswered task
);
handler.quarantine("training task passed its per-task deadline");
await settled;

assert(
  handler.couldNotBeStopped(),
  "expected couldNotBeStopped() after quarantining an unanswered task",
);

await runBoundedEvolveTeardown({
  label: "evolveDir",
  persist: async () => {},
  neat: {
    abandonInFlightAtTeardown: () => 0,
    discardUnprocessedResults: () => 0,
  },
  workers: [handler],
  replayQueue: {
    waitForCompletion: async () => {},
    isReplayInProgress: () => false,
  },
  hardDeadlineMS: 0,
  exitOnUnreclaimableWorkers: flag("exit-on-unreclaimable") === "true",
  exitGuard: { graceMS: ${GUARD_GRACE_MS} },
});

const exitCode = flag("exit-code");
if (exitCode !== undefined) Deno.exitCode = Number(exitCode);
console.log("${LAST_STATEMENT}");
`;
  return imports.join("\n") + "\n" + body;
}

/** Write the worker and child fixtures; returns the child's path. */
async function writeFixtures(dir: string): Promise<string> {
  await Deno.writeTextFile(join(dir, "worker.ts"), workerSource());
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
 * The watchdog is armed at spawn with the fallback bound. When
 * `controlMS` is given it is re-armed to that bound as soon as the child
 * prints its last statement, so the control measures "still alive after the
 * caller returned", not "still alive after start-up".
 */
async function runChild(
  childPath: string,
  args: string[],
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
        ...args,
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
    "process exits on its own after a wedged worker is quarantined when exitOnUnreclaimableWorkers is true",
  ignore: SKIP_WINDOWS,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "process-exit-wedged-" });
    try {
      const childPath = await writeFixtures(dir);
      const run = await runChild(childPath, ["--exit-on-unreclaimable=true"]);
      const output = `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`;
      assert(
        !run.killedByWatchdog,
        `child did not exit within ${EXIT_WATCHDOG_MS} ms; ${output}`,
      );
      assertEquals(run.code, 0, output);
      assertStringIncludes(run.stdout, LAST_STATEMENT, output);
      assertStringIncludes(run.stdout + run.stderr, UNSTOPPABLE_NOTICE, output);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "control: without exitOnUnreclaimableWorkers the wedged worker keeps the process alive after the caller returns",
  ignore: SKIP_WINDOWS,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "process-exit-control-" });
    try {
      const childPath = await writeFixtures(dir);
      const run = await runChild(
        childPath,
        ["--exit-on-unreclaimable=false"],
        CONTROL_WATCHDOG_MS,
      );
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

Deno.test({
  name:
    "exit code set by the caller is preserved when a wedged worker is quarantined",
  ignore: SKIP_WINDOWS,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "process-exit-code-" });
    try {
      const childPath = await writeFixtures(dir);
      const run = await runChild(childPath, [
        "--exit-on-unreclaimable=true",
        "--exit-code=7",
      ]);
      const output = `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`;
      assert(
        !run.killedByWatchdog,
        `child did not exit within ${EXIT_WATCHDOG_MS} ms; ${output}`,
      );
      assertEquals(run.code, 7, output);
      assertStringIncludes(run.stdout, LAST_STATEMENT, output);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
