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
  stdout: string;
  stderr: string;
}

async function runFixture(mode: string): Promise<FixtureResult> {
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

for (const entry of ["dir", "env", "rl"] as const) {
  Deno.test(
    `EvolveFirstGenerationBusyLoop (${entry}-return): a normal run returns and its watchdog does not keep the process alive`,
    async () => {
      // An armed Worker keeps the process alive until its deadline, so a run
      // that returns but never disarms would hang until the guard SIGKILLs it.
      // The guard firing is therefore the failure this case catches.
      const result = await runFixture(`${entry}-return`);
      assert(
        !result.guardFired,
        "the process did not exit after the run returned",
      );
      assertEquals(result.code, 0, `stderr: ${result.stderr}`);
      assert(
        result.stdout.includes("fixture-returned"),
        `stdout: ${result.stdout}`,
      );
    },
  );
}
