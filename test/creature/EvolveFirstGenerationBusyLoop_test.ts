/**
 * Issue #4067, part of #4060: a first generation that blocks the main thread
 * must still end the process.
 *
 * `EvolveDirFirstGenerationWedged.ts` cannot catch this. Its stubbed `evolve`
 * returns a never-settling promise, which yields the event loop, so the
 * in-process `setInterval` bound still fires and returns a
 * `terminationReason`. A synchronous `for (;;) {}` never yields, so only the
 * off-main-thread watchdog can end it. The run therefore ends by SIGKILL
 * (exit 137) with the breach line on stderr, not by a returned result.
 *
 * Each case runs `fixtures/BusyLoopFirstGenerationFixture.ts` in a child
 * `deno run`, so the SIGKILL and exit status are real. The 60 s SIGKILL
 * hang-guard fires only when a regression would otherwise hang the suite.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const FIXTURE = new URL(
  "./fixtures/BusyLoopFirstGenerationFixture.ts",
  import.meta.url,
);
const DENO_CONFIG = new URL("../../deno.json", import.meta.url);

interface FixtureResult {
  code: number;
  signal: Deno.Signal | null;
  /** True when the hang-guard timer, not the watchdog, ended the child. */
  guardFired: boolean;
  stderr: string;
}

async function runFixture(mode: "dir" | "env" | "rl"): Promise<FixtureResult> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--config",
      fromFileUrl(DENO_CONFIG),
      "--allow-read",
      "--allow-write",
      "--allow-net",
      "--allow-env",
      "--allow-run",
      "--allow-ffi",
      fromFileUrl(FIXTURE),
      mode,
    ],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  // Hang guard only. The fixture never yields, so the guard sends SIGKILL.
  let guardFired = false;
  const guard = setTimeout(() => {
    guardFired = true;
    child.kill("SIGKILL");
  }, 60_000);
  try {
    const { code, signal, stderr } = await child.output();
    return {
      code,
      signal,
      guardFired,
      stderr: new TextDecoder().decode(stderr),
    };
  } finally {
    clearTimeout(guard);
  }
}

for (const mode of ["dir", "env", "rl"] as const) {
  Deno.test(
    `EvolveFirstGenerationBusyLoop (${mode}): a synchronous first generation is SIGKILLed at its bound`,
    async () => {
      const result = await runFixture(mode);
      assert(
        !result.guardFired,
        "the hang guard ended the process, not the watchdog",
      );
      assertEquals(result.code, 137, `stderr: ${result.stderr}`);
      assertEquals(result.signal, "SIGKILL");
      assert(
        result.stderr.includes("First generation wedged after"),
        `breach line missing from stderr: ${result.stderr}`,
      );
      assert(
        result.stderr.includes("first-generation-wedged"),
        `breach reason missing from stderr: ${result.stderr}`,
      );
    },
  );
}
