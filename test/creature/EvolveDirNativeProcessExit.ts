/** Process integration: bound hangs without asserting elapsed-time measurements. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  nativeProcessFixture,
  REPO_ROOT,
} from "../architecture/training/_nativeProcessFixture.ts";

async function runQuarantine(lateReturn: boolean): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "evolve-native-exit-" });
  let child: Deno.ChildProcess | undefined;
  let exited = false;
  let killed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fixture = await nativeProcessFixture(dir);
    child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        "--no-lock",
        "--config",
        fromFileUrl(new URL("deno.json", REPO_ROOT)),
        fromFileUrl(
          new URL("fixtures/EvolveDirNativeQuarantine.ts", import.meta.url),
        ),
        ...(lateReturn ? ["--late-return"] : []),
      ],
      env: fixture.env,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const process = child;
    timer = setTimeout(() => {
      killed = true;
      process.kill("SIGKILL");
    }, 30_000);
    const stdout: string[] = [];
    const read = async () => {
      let pending = "";
      for await (
        const chunk of process.stdout.pipeThrough(new TextDecoderStream())
      ) {
        pending += chunk;
        const lines = pending.split("\n");
        pending = lines.pop()!;
        for (const line of lines) {
          stdout.push(line);
          if (line.startsWith("NATIVE_TRAIN_ENTERED")) process.kill("SIGUSR1");
          if (lateReturn && line === "EVOLVE_RETURNED") await fixture.release();
          if (lateReturn && line === "NATIVE_TRAIN_FINISHED") {
            process.kill("SIGUSR2");
          }
        }
      }
      if (pending) stdout.push(pending);
    };
    const [status, , stderr] = await Promise.all([
      process.status,
      read(),
      new Response(process.stderr).text(),
    ]);
    exited = true;
    const output = stdout.join("\n") + "\n" + stderr;
    assertStringIncludes(output, "NATIVE_TRAIN_ENTERED", output);
    assertStringIncludes(output, "TRAINING_QUARANTINED", output);
    assertStringIncludes(output, "quarantined — training task", output);
    assertStringIncludes(output, "EVOLVE_RETURNED", output);
    assertStringIncludes(output, "CALLER_LAST_STATEMENT", output);
    assertEquals(killed, false, output);
    assertEquals(status.code, 0, output);
    if (lateReturn) {
      assertStringIncludes(output, "NATIVE_TRAIN_FINISHED", output);
      const request = JSON.parse(
        await Deno.readTextFile(fixture.env.NEAT_TEST_REQUEST),
      );
      assert(
        Number.isSafeInteger(request.deadlineEpochMs) &&
          request.deadlineEpochMs > 0,
      );
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (child && !exited) {
      child.kill("SIGKILL");
      await child.status;
    }
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test({
  name:
    "evolveDir exits after scheduled native training is quarantined without the exit guard",
  ignore: Deno.build.os === "windows", // POSIX C fixture and signals; fleet platforms are macOS/Linux.
  fn: () => runQuarantine(false),
});

Deno.test({
  name:
    "native training can return safely after evolveDir terminates its worker",
  ignore: Deno.build.os === "windows", // POSIX C fixture and signals.
  fn: () => runQuarantine(true),
});
