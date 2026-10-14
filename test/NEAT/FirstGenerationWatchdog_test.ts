import {
  assert,
  assertEquals,
  assertExists,
  assertMatch,
  assertRejects,
} from "@std/assert";
import {
  armFirstGenerationWatchdog,
  fireFirstGenerationWatchdog,
  type FirstGenerationWatchdogActions,
  firstGenerationWatchdogRequest,
  isFirstGenerationWatchdogDue,
  pollFirstGenerationWatchdog,
  withFirstGenerationWatchdog,
} from "../../src/NEAT/FirstGenerationWatchdog.ts";
import { HARD_DEADLINE_WATCHDOG_INTERVAL_MS } from "../../src/NEAT/HardDeadline.ts";

/**
 * Issue #4060: the off-thread first-generation watchdog. The decision and the
 * side effects are injectable, so the in-process cases never kill the test
 * process; the cases that need the real worker (which SIGKILLs, or must fail
 * to load) run in a child process. The entry-point wiring is covered by
 * `test/creature/FirstGenerationBlockedEventLoop_test.ts`.
 */

const REQUEST = { deadlineMS: 1_000, slackMS: 500 };

Deno.test("isFirstGenerationWatchdogDue: only strictly past deadline + slack", () => {
  assertEquals(isFirstGenerationWatchdogDue(1_499, REQUEST), false);
  assertEquals(isFirstGenerationWatchdogDue(1_500, REQUEST), false);
  assertEquals(isFirstGenerationWatchdogDue(1_501, REQUEST), true);
});

Deno.test("fireFirstGenerationWatchdog: logs the wedge and kills once", () => {
  const lines: string[] = [];
  let kills = 0;
  fireFirstGenerationWatchdog(90_000, { startMS: 0 }, {
    log: (line) => lines.push(line),
    kill: () => {
      kills++;
    },
  });
  assertEquals(lines.length, 1);
  assert(lines[0].includes("[Neat] First generation wedged after 90s"));
  assert(lines[0].includes("first-generation-wedged"));
  assert(lines[0].includes("main thread was not yielding"));
  assertEquals(kills, 1);
});

Deno.test("fireFirstGenerationWatchdog: a failing kill is reported, not thrown", () => {
  const lines: string[] = [];
  fireFirstGenerationWatchdog(90_000, { startMS: 0 }, {
    log: (line) => lines.push(line),
    kill: () => {
      throw new Deno.errors.NotCapable("Requires run access");
    },
  });
  assertEquals(lines.length, 2);
  assert(
    lines[1].includes("could not terminate the process: Requires run access —"),
    lines[1],
  );
});

Deno.test("fireFirstGenerationWatchdog: a non-Error kill failure is reported as text", () => {
  const lines: string[] = [];
  fireFirstGenerationWatchdog(90_000, { startMS: 0 }, {
    log: (line) => lines.push(line),
    kill: () => {
      // deno-lint-ignore no-throw-literal
      throw "kill refused";
    },
  });
  assertEquals(lines.length, 2);
  assert(
    lines[1].includes("could not terminate the process: kill refused —"),
    lines[1],
  );
});

Deno.test("fireFirstGenerationWatchdog: a failing log still kills", () => {
  let kills = 0;
  fireFirstGenerationWatchdog(90_000, { startMS: 0 }, {
    log: () => {
      throw new Error("log sink closed");
    },
    kill: () => {
      kills++;
    },
  });
  assertEquals(kills, 1);
});

Deno.test("firstGenerationWatchdogRequest: carries the run's clock and the poll interval", () => {
  assertEquals(firstGenerationWatchdogRequest(10, 2_000, 300), {
    startMS: 10,
    deadlineMS: 2_000,
    slackMS: 300,
    pollIntervalMS: HARD_DEADLINE_WATCHDOG_INTERVAL_MS,
  });
});

/** Let `ticks` poll intervals of 1 ms (and then some) pass. */
function afterTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ticks * 10));
}

Deno.test("pollFirstGenerationWatchdog: never fires before it is due", async () => {
  let fired = 0;
  const actions: FirstGenerationWatchdogActions = {
    log: () => fired++,
    kill: () => fired++,
  };
  const stop = pollFirstGenerationWatchdog(
    { startMS: 0, deadlineMS: 1_000, slackMS: 500, pollIntervalMS: 1 },
    actions,
    () => 1_500,
  );
  await afterTicks(10);
  stop();
  assertEquals(fired, 0);
});

Deno.test("pollFirstGenerationWatchdog: fires once when due, even if the kill fails", async () => {
  const lines: string[] = [];
  let kills = 0;
  const stop = pollFirstGenerationWatchdog(
    { startMS: 0, deadlineMS: 1_000, slackMS: 500, pollIntervalMS: 1 },
    {
      log: (line) => lines.push(line),
      kill: () => {
        kills++;
        throw new Error("kill refused");
      },
    },
    () => 1_501,
  );
  await afterTicks(10);
  stop();
  assertEquals(kills, 1);
  assertEquals(lines.length, 2);
  assert(lines[0].includes("[Neat] First generation wedged after 2s"));
});

Deno.test("armFirstGenerationWatchdog: no bound means nothing is spawned", () => {
  assertEquals(armFirstGenerationWatchdog(0, 0), undefined);
});

Deno.test({
  name:
    "armFirstGenerationWatchdog: a bound arms a watchdog that can be disarmed",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => {
    const watchdog = armFirstGenerationWatchdog(
      0,
      Number.MAX_SAFE_INTEGER / 2,
    );
    assertExists(watchdog);
    watchdog.disarm();
  },
});

// The terminated worker can outlive the test's op/resource accounting by a
// tick, so the sanitizers are off for the real-worker cases.
Deno.test({
  name: "withFirstGenerationWatchdog: returns the run's value",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const value = await withFirstGenerationWatchdog(
      0,
      Number.MAX_SAFE_INTEGER / 2,
      undefined,
      () => Promise.resolve(42),
    );
    assertEquals(value, 42);
  },
});

Deno.test({
  name: "withFirstGenerationWatchdog: a rejection propagates",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await assertRejects(
      () =>
        withFirstGenerationWatchdog(
          0,
          Number.MAX_SAFE_INTEGER / 2,
          undefined,
          () => Promise.reject(new Error("boom")),
        ),
      Error,
      "boom",
    );
  },
});

const GUARD_MS = 60_000;

interface ChildResult {
  guardFired: boolean;
  success: boolean;
  signal: Deno.Signal | null;
  stdout: string;
  stderr: string;
}

/**
 * Run `code` in a child `deno run` with only the given permission flags, so a
 * SIGKILL (or a worker that cannot load) never touches the test process.
 */
async function runChild(code: string, flags: string[]): Promise<ChildResult> {
  const dir = await Deno.makeTempDir({ prefix: "neat-4060-watchdog-" });
  try {
    const script = `${dir}/child.ts`;
    await Deno.writeTextFile(script, code);
    const child = new Deno.Command(Deno.execPath(), {
      args: ["run", "--config", "./deno.json", "--no-prompt", ...flags, script],
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
    return {
      guardFired,
      success: output.success,
      signal: output.signal,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const WATCHDOG_MODULE = new URL(
  "../../src/NEAT/FirstGenerationWatchdog.ts",
  import.meta.url,
).href;

Deno.test({
  name:
    "armFirstGenerationWatchdog: a blocked main thread is logged and SIGKILLed",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const r = await runChild(
      `
import { armFirstGenerationWatchdog } from ${JSON.stringify(WATCHDOG_MODULE)};
const now = Date.now();
armFirstGenerationWatchdog(now - 100_000, now - 1, 0);
for (;;) { /* block the event loop */ }
`,
      ["--allow-read"],
    );
    const detail = `\nstderr:\n${r.stderr}\nstdout:\n${r.stdout}`;
    assert(!r.guardFired, `the watchdog never fired${detail}`);
    assertEquals(r.signal, "SIGKILL", `child must be SIGKILLed${detail}`);
    assertMatch(r.stderr, /\[Neat\] First generation wedged after 10\ds/);
  },
});

Deno.test({
  name:
    "withFirstGenerationWatchdog: a watchdog that cannot load is logged and the run still resolves",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // No --allow-read: the main module graph loads, but the worker's module
    // does not, so the worker errors before it ever polls.
    const r = await runChild(
      `
import { withFirstGenerationWatchdog } from ${JSON.stringify(WATCHDOG_MODULE)};
import { setLogger } from "@utils/Logger.ts";
let warned;
const warning = new Promise((resolve) => (warned = resolve));
setLogger({
  debug: () => {},
  info: () => {},
  error: (...a) => console.error(...a),
  warn: (...a) => {
    console.error(...a);
    warned();
  },
});
const value = await withFirstGenerationWatchdog(
  Date.now(),
  Date.now() + 600_000,
  undefined,
  () => warning.then(() => 42),
);
console.log("RESULT=" + value);
`,
      [],
    );
    const detail = `\nstderr:\n${r.stderr}\nstdout:\n${r.stdout}`;
    assert(!r.guardFired, `the run never resolved${detail}`);
    assert(r.success, `child must exit cleanly${detail}`);
    assert(r.stdout.includes("RESULT=42"), `missing result${detail}`);
    assert(
      r.stderr.includes(
        "[Neat] First-generation watchdog unavailable: Requires read access",
      ),
      `missing warning${detail}`,
    );
  },
});
