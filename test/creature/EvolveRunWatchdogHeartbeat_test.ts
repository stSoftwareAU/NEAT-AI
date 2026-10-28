/**
 * Run-level watchdog heartbeat — Issue #4096, part of #4060.
 *
 * `armRunWatchdog` (`src/creature/EvolveRunWatchdog.ts`) re-arms the event-loop
 * watchdog from the first-generation bound to the hard cap once generation 1
 * completes. The breach line it produces carries the main-thread heartbeat age
 * and the in-flight phase. These cases run in a child `deno run` so the SIGKILL,
 * the exit status and the breach line are real.
 *
 * A main thread that busy-loops after generation 2 never ticks the heartbeat,
 * so `lastHeartbeatAgeMs` is at least the busy duration. A main thread that
 * yields keeps the heartbeat fresh, so its age stays near one interval.
 *
 * The fixtures read the clock inside their own source text. This file never
 * reads the clock and never waits on a timer for an assertion. The 60 s SIGKILL
 * hang-guard timer in `runFixture` fires only when a regression would otherwise
 * hang the suite. The fixtures swallow SIGTERM, so SIGTERM cannot be that guard.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const WATCHDOG_MODULE_URL = new URL(
  "../../src/creature/EvolveRunWatchdog.ts",
  import.meta.url,
).href;

/** The repo's deno.json, so the child resolves the `@neat/` import map. */
const DENO_JSON_PATH = fromFileUrl(
  new URL("../../deno.json", import.meta.url),
);

interface FixtureResult {
  code: number;
  signal: Deno.Signal | null;
  /** True when the hang-guard timer, not the fixture, ended the child. */
  guardFired: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run `body` as a `deno run` child that loads the repo's import map. The body
 * is appended after an import of `armRunWatchdog` by absolute file URL.
 */
async function runFixture(body: string): Promise<FixtureResult> {
  const dir = await Deno.makeTempDir({
    prefix: "evolve-run-watchdog-heartbeat-",
  });
  try {
    const fixturePath = join(dir, "fixture.ts");
    await Deno.writeTextFile(
      fixturePath,
      `import { armRunWatchdog } from "${WATCHDOG_MODULE_URL}";\n${body}\n`,
    );
    const command = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "--no-lock", "-c", DENO_JSON_PATH, fixturePath],
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
 * Build the fixture source. It arms the run watchdog, yields once so the
 * generation 1 heartbeat ticks, completes generations 1 and 2 (the second
 * re-arms to the hard cap), declares the `mutation` phase, prints the hard cap
 * and the busy-start instant, and then runs `tail`.
 */
function fixture(tail: string): string {
  return `
Deno.addSignalListener("SIGTERM", () => {});
const hard = Date.now() + 2_500;
const w = armRunWatchdog({
  timeoutMinutes: 1,
  startMS: Date.now(),
  firstGenerationDeadlineMS: Date.now() + 3_600_000,
  hardDeadlineMS: hard,
  now: Date.now,
  marginMS: 0,
});
await new Promise((resolve) => setTimeout(resolve, 1_100));
w.generationCompleted(1);
w.generationCompleted(2);
w.setPhase("mutation");
const busyStart = Date.now();
console.log(JSON.stringify({ hard, busyStart }));
${tail}
`;
}

/**
 * Read `lastHeartbeatAgeMs` from a breach line. Fails the test if it is absent.
 */
function heartbeatAgeMs(stderr: string): number {
  const match = /lastHeartbeatAgeMs=(\d+)/.exec(stderr);
  assert(match !== null, `lastHeartbeatAgeMs missing from stderr: ${stderr}`);
  return Number(match[1]);
}

Deno.test("EvolveRunWatchdogHeartbeat: a busy main thread in generation 2 is killed with a heartbeat age at least the busy duration", async () => {
  const result = await runFixture(fixture("for (;;) {}"));
  // The watchdog, not the hang guard, must end the process.
  assert(
    !result.guardFired,
    "the hang guard ended the process, not the watchdog",
  );
  assertEquals(result.code, 137, `stderr: ${result.stderr}`);
  assertEquals(result.signal, "SIGKILL");
  assert(
    result.stderr.includes("[Neat] Run wedged after"),
    `breach line missing from stderr: ${result.stderr}`,
  );
  assert(
    result.stderr.includes("at generation 2"),
    `breach line must name generation 2: ${result.stderr}`,
  );
  assert(
    result.stderr.includes("inFlightPhase=mutation"),
    `stderr: ${result.stderr}`,
  );
  const { hard, busyStart } = JSON.parse(result.stdout) as {
    hard: number;
    busyStart: number;
  };
  // The loop never ticks after busyStart, so the newest beat is no later than
  // busyStart, and the breach is no earlier than the hard cap.
  const age = heartbeatAgeMs(result.stderr);
  assert(
    age >= hard - busyStart,
    `heartbeat age ${age} ms is below the ${
      hard - busyStart
    } ms busy duration: ${result.stderr}`,
  );
});

Deno.test("EvolveRunWatchdogHeartbeat: a yielding main thread in generation 2 keeps its heartbeat age near one interval", async () => {
  const result = await runFixture(
    fixture("await new Promise((resolve) => setTimeout(resolve, 10_000));"),
  );
  assert(
    !result.guardFired,
    "the hang guard ended the process, not the watchdog",
  );
  assertEquals(result.code, 137, `stderr: ${result.stderr}`);
  assertEquals(result.signal, "SIGKILL");
  assert(
    result.stderr.includes("[Neat] Run wedged after"),
    `breach line missing from stderr: ${result.stderr}`,
  );
  assert(
    result.stderr.includes("at generation 2"),
    `breach line must name generation 2: ${result.stderr}`,
  );
  // The heartbeat ticks every default interval (1000 ms) while the loop yields,
  // so the age at breach stays well under 2500 ms.
  const age = heartbeatAgeMs(result.stderr);
  assert(
    age < 2_500,
    `heartbeat age ${age} ms is too large for a loop that kept ticking: ${result.stderr}`,
  );
});
