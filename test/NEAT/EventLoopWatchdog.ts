/**
 * Event-loop watchdog — Issue #4066, part of #4060.
 *
 * The behaviour that matters is process-level: a main thread that is blocked
 * or that swallows SIGTERM must still be killed at the deadline, a disarmed
 * watchdog must not kill a run that finished, and a Worker that cannot load
 * must degrade to a logged no-op rather than crash the run. Those cases run in
 * a child `deno run` so the SIGKILL and exit status are real.
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
} from "../../src/NEAT/EventLoopWatchdog.ts";
import { ConfigurationError } from "../../src/errors/ConfigurationError.ts";

const MODULE_URL = new URL(
  "../../src/NEAT/EventLoopWatchdog.ts",
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
 */
async function runFixture(
  body: string,
  permFlags: string[],
): Promise<FixtureResult> {
  const dir = await Deno.makeTempDir({ prefix: "event-loop-watchdog-" });
  try {
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
