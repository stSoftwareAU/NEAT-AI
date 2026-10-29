/**
 * Event-loop watchdog — Issue #4066, part of #4060.
 *
 * The behaviour that matters is process-level: a main thread that is blocked
 * or that swallows SIGTERM must still be killed at the deadline, a disarmed
 * watchdog must not kill a run that finished, and a Worker that cannot load
 * must degrade to a logged no-op rather than crash the run. Those cases run in
 * a child `deno run` so the SIGKILL and exit status are real. The heartbeat
 * tests check the measured liveness in the breach line: a busy loop never ticks
 * after arm, so its age is at least the time to the deadline, while a yielding
 * loop keeps its age near one heartbeat interval.
 *
 * The fixtures compute their deadlines with `Date.now()` inside their own
 * source text. This file never reads the clock and never waits on a timer for
 * an assertion. The 60 s SIGKILL hang-guard timer in `runFixture` fires only
 * when a regression would otherwise hang the suite. The fixtures swallow
 * SIGTERM, so SIGTERM cannot be that guard.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  armEventLoopWatchdog,
  EVENT_LOOP_WATCHDOG_GENERATION_TOKEN,
  EVENT_LOOP_WATCHDOG_PHASES,
} from "../../src/NEAT/EventLoopWatchdog.ts";
import { ConfigurationError } from "../../src/errors/ConfigurationError.ts";

const MODULE_URL = new URL(
  "../../src/NEAT/EventLoopWatchdog.ts",
  import.meta.url,
).href;

const WORKER_MODULE_URL = new URL(
  "../../src/NEAT/EventLoopWatchdogWorker.ts",
  import.meta.url,
).href;

interface FixtureResult {
  code: number;
  signal: Deno.Signal | null;
  /** True when the hang-guard timer, not the fixture, ended the child. */
  guardFired: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run `body` as a `deno run` child with the given permission flags. The body
 * is appended after an import of the watchdog module by absolute file URL.
 * `extraFiles` are written next to the fixture, keyed by file name.
 */
async function runFixture(
  body: string,
  permFlags: string[],
  extraFiles: Record<string, string> = {},
): Promise<FixtureResult> {
  const dir = await Deno.makeTempDir({ prefix: "event-loop-watchdog-" });
  try {
    await Promise.all(
      Object.entries(extraFiles).map(([name, text]) =>
        Deno.writeTextFile(join(dir, name), text)
      ),
    );
    const fixturePath = join(dir, "fixture.ts");
    await Deno.writeTextFile(
      fixturePath,
      `import { armEventLoopWatchdog } from "${MODULE_URL}";\n${body}\n`,
    );
    const command = new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-config", "--no-lock", ...permFlags, fixturePath],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    const child = command.spawn();
    // Hang guard only. SIGTERM cannot end a fixture that swallows it, so the
    // guard sends SIGKILL.
    let guardFired = false;
    const guard = setTimeout(() => {
      guardFired = true;
      child.kill("SIGKILL");
    }, 60_000);
    try {
      const { code, signal, stdout, stderr } = await child.output();
      return {
        code,
        signal,
        guardFired,
        stdout: new TextDecoder().decode(stdout),
        stderr: new TextDecoder().decode(stderr),
      };
    } finally {
      clearTimeout(guard);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/**
 * Read `lastHeartbeatAgeMs` from a breach line. Fails the test if it is absent.
 */
function heartbeatAgeMs(stderr: string): number {
  const match = /lastHeartbeatAgeMs=(\d+)/.exec(stderr);
  assert(match !== null, `lastHeartbeatAgeMs missing from stderr: ${stderr}`);
  return Number(match[1]);
}

Deno.test("EventLoopWatchdogKillsBlockedMainThread: SIGKILLs a busy-looping main thread that swallows SIGTERM", async () => {
  const result = await runFixture(
    `
Deno.addSignalListener("SIGTERM", () => {});
const w = armEventLoopWatchdog({
  deadlineEpochMS: Date.now() - 1_000,
  breachLine: "[Neat] watchdog-test breach at generation ${EVENT_LOOP_WATCHDOG_GENERATION_TOKEN}",
});
w.setGeneration(7);
for (;;) {}
`,
    ["--allow-read"],
  );
  // The watchdog must end the process itself. A SIGKILL from the hang guard
  // would also look like exit 137, so the guard's firing is asserted separately.
  assert(
    !result.guardFired,
    "the hang guard ended the process, not the watchdog",
  );
  assertEquals(result.code, 137, `stderr: ${result.stderr}`);
  assertEquals(result.signal, "SIGKILL");
  assert(
    result.stderr.includes("[Neat] watchdog-test breach at generation 7"),
    `breach line missing from stderr: ${result.stderr}`,
  );
});

Deno.test("EventLoopWatchdog breach line names an unknown generation when none was set", async () => {
  const result = await runFixture(
    `
const w = armEventLoopWatchdog({
  deadlineEpochMS: Date.now() - 1_000,
  breachLine: "[Neat] watchdog-test breach at generation ${EVENT_LOOP_WATCHDOG_GENERATION_TOKEN}",
});
for (;;) {}
`,
    ["--allow-read"],
  );
  // As in the SIGKILL test above: the watchdog, not the hang guard, must end
  // the process.
  assert(
    !result.guardFired,
    "the hang guard ended the process, not the watchdog",
  );
  assertEquals(result.code, 137, `stderr: ${result.stderr}`);
  assertEquals(result.signal, "SIGKILL");
  assert(
    result.stderr.includes("[Neat] watchdog-test breach at generation unknown"),
    `breach line missing from stderr: ${result.stderr}`,
  );
});

Deno.test("EventLoopWatchdogDisarm: disarm() lets the process exit 0 without the breach", async () => {
  const result = await runFixture(
    `
const w = armEventLoopWatchdog({
  deadlineEpochMS: Date.now() + 3_600_000,
  breachLine: "[Neat] watchdog-test disarm breach",
});
w.disarm();
w.disarm();
console.log("returned normally");
`,
    ["--allow-read"],
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  assertEquals(result.signal, null);
  assert(
    result.stdout.includes("returned normally"),
    `stdout: ${result.stdout}`,
  );
  assert(
    !result.stderr.includes("[Neat] watchdog-test disarm breach"),
    `breach line must not appear after disarm: ${result.stderr}`,
  );
});

Deno.test("EventLoopWatchdog unavailable: a Worker that cannot load logs one loud line and returns a no-op handle", async () => {
  const result = await runFixture(
    `
armEventLoopWatchdog({
  deadlineEpochMS: Date.now() - 1_000,
  breachLine: "[Neat] watchdog-test unavailable breach",
});
`,
    [],
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  assert(
    result.stderr.includes("[Neat] event-loop watchdog unavailable:"),
    `stderr: ${result.stderr}`,
  );
  assert(
    result.stderr.includes("Requires read access"),
    `stderr: ${result.stderr}`,
  );
  assert(
    result.stderr.includes("only the in-process bound applies"),
    `stderr: ${result.stderr}`,
  );
  assert(
    !result.stderr.includes("[Neat] watchdog-test unavailable breach"),
    `breach line must not appear when unavailable: ${result.stderr}`,
  );
});

Deno.test("EventLoopWatchdog unavailable: a Worker constructor that throws logs the cause and returns a no-op handle", async () => {
  // Replacing the global \`Worker\` is the only way to make \`new Worker\` throw
  // synchronously; the fixture runs in its own process, so nothing else sees it.
  // Both an Error and a non-Error throw are staged, one per arm.
  const result = await runFixture(
    `
const throwing = [new Error("staged spawn failure"), "staged string failure"];
globalThis.Worker = class {
  constructor() {
    throw throwing.shift();
  }
} as unknown as typeof Worker;
for (let i = 0; i < 2; i++) {
  const w = armEventLoopWatchdog({
    deadlineEpochMS: Date.now() - 1_000,
    breachLine: "[Neat] watchdog-test spawn-failure breach",
  });
  w.setGeneration(-1);
  w.disarm();
}
console.log("no-op handle returned");
`,
    ["--allow-read"],
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  assert(
    result.stdout.includes("no-op handle returned"),
    `stdout: ${result.stdout}`,
  );
  assert(
    result.stderr.includes(
      "[Neat] event-loop watchdog unavailable: staged spawn failure — only the in-process bound applies",
    ),
    `stderr: ${result.stderr}`,
  );
  assert(
    result.stderr.includes(
      "[Neat] event-loop watchdog unavailable: staged string failure — only the in-process bound applies",
    ),
    `stderr: ${result.stderr}`,
  );
});

Deno.test("EventLoopWatchdogWorker: a kill that fails is reported on stderr after the breach line", async () => {
  // The Worker module is loaded behind a wrapper whose first import replaces
  // \`Deno.kill\` inside the Worker, so the breach reaches a kill that throws.
  const result = await runFixture(
    `
const generationBuffer = new SharedArrayBuffer(8);
Atomics.store(new Int32Array(generationBuffer), 0, 4);
const worker = new Worker(new URL("./wrapper.ts", import.meta.url), {
  type: "module",
});
worker.addEventListener("error", (event) => {
  event.preventDefault();
  worker.terminate();
  console.log("worker error: " + event.message);
});
worker.postMessage({
  deadlineEpochMS: Date.now() - 1_000,
  breachLine: "[Neat] watchdog-test failed-kill breach at generation {generation}",
  generationBuffer,
  heartbeatBuffer: new SharedArrayBuffer(8),
  phaseNames: ["untracked"],
  heartbeatIntervalMS: 100,
});
`,
    ["--allow-read"],
    {
      "patch.ts": `Object.defineProperty(Deno, "kill", {
  value: () => {
    throw new Error("staged kill failure");
  },
});
`,
      "wrapper.ts": `import "./patch.ts";\nimport "${WORKER_MODULE_URL}";\n`,
    },
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  // The line carries the liveness suffix after the breach text and must end in
  // a newline, so the kill failure that follows starts on its own line.
  const breachPrefix =
    "[Neat] watchdog-test failed-kill breach at generation 4 " +
    "lastHeartbeatAgeMs=";
  const breachAt = result.stderr.indexOf(breachPrefix);
  assert(breachAt >= 0, `breach line missing from stderr: ${result.stderr}`);
  const suffix = "inFlightPhase=untracked heartbeatIntervalMS=100\n";
  const suffixAt = result.stderr.indexOf(suffix, breachAt);
  assert(
    suffixAt >= 0,
    `breach line must end with the suffix and a newline: ${result.stderr}`,
  );
  const failureAt = result.stderr.indexOf(
    "[Neat] event-loop watchdog could not kill the process: staged kill failure\n",
  );
  assert(
    failureAt >= suffixAt + suffix.length,
    `kill failure must follow the breach line: ${result.stderr}`,
  );
  // The failure is rethrown, so the Worker reports it rather than going quiet.
  assert(
    result.stdout.includes("worker error:") &&
      result.stdout.includes("staged kill failure"),
    `stdout: ${result.stdout}`,
  );
});

Deno.test("armEventLoopWatchdog refuses a non-finite deadline", () => {
  for (
    const deadlineEpochMS of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]
  ) {
    const err = assertThrows(
      () => armEventLoopWatchdog({ deadlineEpochMS, breachLine: "x" }),
      ConfigurationError,
    );
    assertEquals(err.reason, "NOT_FINITE");
  }
});

Deno.test("armEventLoopWatchdog refuses an empty breach line", () => {
  // The deadline is finite, so only the breach-line rule can refuse this call.
  // It is far in the future so that a broken check can never breach and kill
  // the test runner.
  const err = assertThrows(
    () =>
      armEventLoopWatchdog({
        deadlineEpochMS: Number.MAX_SAFE_INTEGER,
        breachLine: "  ",
      }),
    ConfigurationError,
  );
  assertEquals(err.reason, "INVALID_TYPE");
});

Deno.test("armEventLoopWatchdog refuses a non-string breach line", () => {
  // Same reasoning as above: finite, far-future deadline, so only the
  // typeof rule can refuse this call.
  const err = assertThrows(
    () =>
      armEventLoopWatchdog({
        deadlineEpochMS: Number.MAX_SAFE_INTEGER,
        breachLine: 42 as unknown as string,
      }),
    ConfigurationError,
  );
  assertEquals(err.reason, "INVALID_TYPE");
});

Deno.test("setGeneration refuses a non-integer or out-of-range generation", () => {
  // Far-future deadline so the Worker never breaches during this in-process test.
  const watchdog = armEventLoopWatchdog({
    deadlineEpochMS: Number.MAX_SAFE_INTEGER,
    breachLine: "[Neat] watchdog-test in-process breach",
  });
  try {
    assertEquals(
      assertThrows(() => watchdog.setGeneration(1.5), ConfigurationError)
        .reason,
      "NOT_INTEGER",
    );
    assertEquals(
      assertThrows(() => watchdog.setGeneration(-1), ConfigurationError)
        .reason,
      "OUT_OF_RANGE",
    );
    assertEquals(
      assertThrows(() => watchdog.setGeneration(2 ** 31), ConfigurationError)
        .reason,
      "OUT_OF_RANGE",
    );
    watchdog.setGeneration(0);
    watchdog.setGeneration(3);
  } finally {
    watchdog.disarm();
  }
});

Deno.test("EventLoopWatchdogHeartbeat: a busy-looping main thread shows a heartbeat age at least the time since arm", async () => {
  // The main loop is busy from the moment it arms, so it never ticks the
  // heartbeat. The newest heartbeat is the one taken at arm, which is no later
  // than afterArm, and the breach is no earlier than the deadline. So the age
  // at breach is at least deadline - afterArm.
  const result = await runFixture(
    `
Deno.addSignalListener("SIGTERM", () => {});
const deadline = Date.now() + 1_500;
armEventLoopWatchdog({
  deadlineEpochMS: deadline,
  breachLine: "[Neat] watchdog-test busy breach at generation ${EVENT_LOOP_WATCHDOG_GENERATION_TOKEN}",
  heartbeatIntervalMS: 100,
});
const afterArm = Date.now();
console.log(JSON.stringify({ deadline, afterArm }));
for (;;) {}
`,
    ["--allow-read"],
  );
  assert(
    !result.guardFired,
    "the hang guard ended the process, not the watchdog",
  );
  assertEquals(result.code, 137, `stderr: ${result.stderr}`);
  assertEquals(result.signal, "SIGKILL");
  assert(
    result.stderr.includes(
      "[Neat] watchdog-test busy breach at generation unknown",
    ),
    `breach line missing from stderr: ${result.stderr}`,
  );
  const { deadline, afterArm } = JSON.parse(result.stdout) as {
    deadline: number;
    afterArm: number;
  };
  const age = heartbeatAgeMs(result.stderr);
  assert(
    age >= deadline - afterArm,
    `heartbeat age ${age} ms is below the ${
      deadline - afterArm
    } ms between arm and the deadline: ${result.stderr}`,
  );
  // The heartbeat is taken at arm, so the age is measured from then and not
  // from the epoch (what an unset slot would give). The bound is loose because
  // a loaded host can start the Worker late.
  assert(
    age < 30_000,
    `heartbeat age ${age} ms was not measured from a heartbeat taken at arm: ${result.stderr}`,
  );
});

Deno.test("EventLoopWatchdogHeartbeat: a yielding main thread that is over budget keeps its heartbeat fresh", async () => {
  // The loop yields for the whole run, so the heartbeat timer keeps ticking
  // and the age at breach stays near one interval, far below the 4 s deadline.
  // The bound is deliberately loose: a loaded host can delay a 100 ms timer
  // tick, so asserting near one interval would be flaky. It asserts only that
  // the age stays below what a blocked loop reports, which is about the full
  // 4 s deadline.
  const result = await runFixture(
    `
armEventLoopWatchdog({
  deadlineEpochMS: Date.now() + 4_000,
  breachLine: "[Neat] watchdog-test yielding breach at generation ${EVENT_LOOP_WATCHDOG_GENERATION_TOKEN}",
  heartbeatIntervalMS: 100,
});
await new Promise((resolve) => setTimeout(resolve, 10_000));
`,
    ["--allow-read"],
  );
  assert(
    !result.guardFired,
    "the hang guard ended the process, not the watchdog",
  );
  assertEquals(result.code, 137, `stderr: ${result.stderr}`);
  assertEquals(result.signal, "SIGKILL");
  assert(
    result.stderr.includes(
      "[Neat] watchdog-test yielding breach at generation unknown",
    ),
    `breach line missing from stderr: ${result.stderr}`,
  );
  const age = heartbeatAgeMs(result.stderr);
  assert(
    age < 3_000,
    `heartbeat age ${age} ms is too large for a loop that kept ticking: ${result.stderr}`,
  );
});

Deno.test("EventLoopWatchdogPhase: the breach line names the phase set before the busy loop", async () => {
  const result = await runFixture(
    `
Deno.addSignalListener("SIGTERM", () => {});
const w = armEventLoopWatchdog({
  deadlineEpochMS: Date.now() + 1_500,
  breachLine: "[Neat] watchdog-test phase breach",
  heartbeatIntervalMS: 100,
});
w.setPhase("mutation");
for (;;) {}
`,
    ["--allow-read"],
  );
  assert(
    !result.guardFired,
    "the hang guard ended the process, not the watchdog",
  );
  assertEquals(result.code, 137, `stderr: ${result.stderr}`);
  assertEquals(result.signal, "SIGKILL");
  assert(
    result.stderr.includes(
      "[Neat] watchdog-test phase breach lastHeartbeatAgeMs=",
    ),
    `breach line missing from stderr: ${result.stderr}`,
  );
  assert(
    result.stderr.includes("inFlightPhase=mutation"),
    `stderr: ${result.stderr}`,
  );
  assert(
    result.stderr.includes("heartbeatIntervalMS=100"),
    `stderr: ${result.stderr}`,
  );
});

Deno.test("EventLoopWatchdogPhase: the breach line reports untracked when no phase was set", async () => {
  const result = await runFixture(
    `
Deno.addSignalListener("SIGTERM", () => {});
armEventLoopWatchdog({
  deadlineEpochMS: Date.now() + 1_500,
  breachLine: "[Neat] watchdog-test untracked breach",
  heartbeatIntervalMS: 100,
});
for (;;) {}
`,
    ["--allow-read"],
  );
  assert(
    !result.guardFired,
    "the hang guard ended the process, not the watchdog",
  );
  assertEquals(result.code, 137, `stderr: ${result.stderr}`);
  assertEquals(result.signal, "SIGKILL");
  assert(
    result.stderr.includes("inFlightPhase=untracked"),
    `stderr: ${result.stderr}`,
  );
  assert(
    result.stderr.includes("heartbeatIntervalMS=100"),
    `stderr: ${result.stderr}`,
  );
});

Deno.test("armEventLoopWatchdog refuses a heartbeat interval that is not finite", () => {
  for (
    const heartbeatIntervalMS of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]
  ) {
    const err = assertThrows(
      () =>
        armEventLoopWatchdog({
          deadlineEpochMS: Number.MAX_SAFE_INTEGER,
          breachLine: "x",
          heartbeatIntervalMS,
        }),
      ConfigurationError,
    );
    assertEquals(err.reason, "NOT_FINITE");
  }
});

Deno.test("armEventLoopWatchdog refuses a heartbeat interval that is not greater than zero", () => {
  for (const heartbeatIntervalMS of [0, -1]) {
    const err = assertThrows(
      () =>
        armEventLoopWatchdog({
          deadlineEpochMS: Number.MAX_SAFE_INTEGER,
          breachLine: "x",
          heartbeatIntervalMS,
        }),
      ConfigurationError,
    );
    assertEquals(err.reason, "OUT_OF_RANGE");
  }
});

Deno.test("armEventLoopWatchdog accepts a positive heartbeat interval", () => {
  // Far-future deadline so the Worker never breaches during this in-process test.
  const watchdog = armEventLoopWatchdog({
    deadlineEpochMS: Number.MAX_SAFE_INTEGER,
    breachLine: "[Neat] watchdog-test in-process breach",
    heartbeatIntervalMS: 50,
  });
  watchdog.disarm();
});

Deno.test("EventLoopWatchdog setPhase refuses a phase outside the list and accepts a listed one", () => {
  // Far-future deadline so the Worker never breaches during this in-process test.
  const watchdog = armEventLoopWatchdog({
    deadlineEpochMS: Number.MAX_SAFE_INTEGER,
    breachLine: "[Neat] watchdog-test in-process breach",
  });
  try {
    const err = assertThrows(
      () => watchdog.setPhase("nonsense" as never),
      ConfigurationError,
    );
    assertEquals(err.reason, "INVALID_TYPE");
    watchdog.setPhase("fitness");
  } finally {
    watchdog.disarm();
  }
});

Deno.test("EventLoopWatchdogPhase: every listed phase is named as itself in the breach line", async () => {
  // The closed list is a contract with whoever reads the breach line. It is
  // spelled out here, so a phase dropped from the source list fails this test.
  // One child per phase, so a phase that shifts the index of the ones after it
  // is named wrongly or refused.
  const expectedPhases = [
    "untracked",
    "fitness",
    "sort",
    "write-scores",
    "breeding",
    "mutation",
    "pre-warm",
    "deduplication",
  ];
  assertEquals([...EVENT_LOOP_WATCHDOG_PHASES], expectedPhases);
  const results = await Promise.all(
    expectedPhases.map(async (phase) => ({
      phase,
      result: await runFixture(
        `
Deno.addSignalListener("SIGTERM", () => {});
const w = armEventLoopWatchdog({
  deadlineEpochMS: Date.now() + 1_500,
  breachLine: "[Neat] watchdog-test every-phase breach",
  heartbeatIntervalMS: 100,
});
w.setPhase("${phase}");
for (;;) {}
`,
        ["--allow-read"],
      ),
    })),
  );
  for (const { phase, result } of results) {
    assert(
      !result.guardFired,
      `${phase}: the hang guard ended the process, not the watchdog`,
    );
    assertEquals(result.code, 137, `${phase}: stderr: ${result.stderr}`);
    assert(
      result.stderr.includes(` inFlightPhase=${phase} heartbeatIntervalMS=`),
      `${phase}: stderr: ${result.stderr}`,
    );
  }
});

Deno.test("EventLoopWatchdogDisarm: disarm() can be called twice", () => {
  const watchdog = armEventLoopWatchdog({
    deadlineEpochMS: Number.MAX_SAFE_INTEGER,
    breachLine: "[Neat] watchdog-test in-process breach",
    heartbeatIntervalMS: 10,
  });
  watchdog.disarm();
  watchdog.disarm();
});
