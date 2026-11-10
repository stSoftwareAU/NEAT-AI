/**
 * Issue #4146 — the production worker entry (`deno/worker.ts`) must install
 * the `trainDir` relay, so the `[training-backend]` line a pooled worker
 * writes before its native call reaches the PARENT's logger.
 *
 * `TrainDirBackendRelay.ts` proves the relay pieces work; this test proves the
 * real worker entry uses them. A child process spawns the real worker through
 * a real `WorkerHandler`, runs a real training task, and reports what its
 * parent-side logger received. Dropping the install from `worker.ts` turns
 * this red: the line would go to the worker isolate's own console instead.
 *
 * The child runs with `NEAT_AI_BACKPROP_ENABLED=0` (set on the child, never on
 * this process) so the task takes the TypeScript loop and needs no native
 * library; the backend is irrelevant to what is asserted here.
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

Deno.test("Issue #4146: the real pooled worker relays its training backend line to the parent logger", () => {
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      "--config",
      `${ROOT}deno.json`,
      "--preload",
      `${ROOT}test/_preload.ts`,
      `${ROOT}test/workers/fixtures/RelayWiringDriver.ts`,
    ],
    env: { NEAT_AI_BACKPROP_ENABLED: "0" },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  const stdout = new TextDecoder().decode(child.stdout);
  const stderr = new TextDecoder().decode(child.stderr);
  assert(child.success, `driver failed: ${stderr}`);

  const marker = stdout.split("\n").find((line) =>
    line.startsWith("PARENT_LOG_LINES=")
  );
  assert(marker !== undefined, `driver printed no log lines: ${stdout}`);
  const lines = JSON.parse(
    marker.slice("PARENT_LOG_LINES=".length),
  ) as string[];
  const backendLines = lines.filter((line) =>
    line.includes("[training-backend]")
  );

  assertEquals(
    backendLines.length,
    1,
    `the parent logger must receive exactly one worker [training-backend] line; got: ${
      JSON.stringify(lines)
    }`,
  );
  assertMatch(
    backendLines[0],
    /^\[training-backend\] task=\S+ backend=wasm deadlineSent=no capability=none$/,
  );
});
