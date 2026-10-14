import { assert, assertEquals } from "@std/assert";
// Statically imported so the entry module is part of this test's graph. It only
// assigns `self.onmessage`; nothing is posted until a message arrives.
import "../../src/NEAT/FirstGenerationWatchdogWorker.ts";

/**
 * Issue #4060: the watchdog worker entry wires `pollFirstGenerationWatchdog`
 * to `getLogger().error` and a real SIGKILL. The fixture runs the entry in a
 * child process so the kill never touches the test process.
 */

const GUARD_MS = 60_000;

Deno.test({
  name:
    "FirstGenerationWatchdogWorker: an overdue request is logged through getLogger and SIGKILLs the process",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const fixture = new URL(
      "./FirstGenerationWatchdogWorkerEntryFixture.ts",
      import.meta.url,
    ).pathname;
    const child = new Deno.Command(Deno.execPath(), {
      args: ["run", "--config", "./deno.json", "--no-prompt", fixture],
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
    const stdout = new TextDecoder().decode(output.stdout);
    const detail = `\nstderr:\n${
      new TextDecoder().decode(output.stderr)
    }\nstdout:\n${stdout}`;
    assert(!guardFired, `the watchdog never fired${detail}`);
    assertEquals(output.signal, "SIGKILL", `child must be SIGKILLed${detail}`);
    assert(
      /CUSTOM-SINK: \[Neat\] First generation wedged after 10\ds/.test(stdout),
      `wedged line must reach the logger${detail}`,
    );
  },
});
