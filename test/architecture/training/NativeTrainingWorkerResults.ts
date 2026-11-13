import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { nativeProcessFixture, REPO_ROOT } from "./_nativeProcessFixture.ts";

for (const cli of [false, true]) {
  for (const failure of [false, true]) {
    Deno.test({
      name: `native worker ${cli ? "CLI" : "FFI"} reports ${
        failure ? "failure with its cause" : "the trained creature and metrics"
      }`,
      ignore: Deno.build.os === "windows", // POSIX C ABI fixture; fleet uses macOS/Linux.
      fn: async () => {
        const dir = await Deno.makeTempDir({ prefix: "native-worker-result-" });
        try {
          const fixture = await nativeProcessFixture(dir, cli);
          const output = await new Deno.Command(Deno.execPath(), {
            args: [
              "run",
              "-A",
              "--no-lock",
              "--config",
              fromFileUrl(new URL("deno.json", REPO_ROOT)),
              fromFileUrl(
                new URL("fixtures/WorkerNativeTrain.ts", import.meta.url),
              ),
              ...(cli ? ["--cli"] : []),
              ...(failure ? ["--error"] : []),
            ],
            env: {
              ...fixture.env,
              TMPDIR: dir,
              NEAT_TEST_NO_WAIT: "1",
              ...(failure ? { NEAT_TEST_ERROR: "1" } : {}),
            },
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
            signal: AbortSignal.timeout(30_000),
          }).output();
          const text = new TextDecoder().decode(output.stdout) +
            new TextDecoder().decode(output.stderr);
          assertEquals(output.code, 0, text);
          assertStringIncludes(text, "WORKER_RESULT_VERIFIED");
          assertStringIncludes(
            text,
            `backend=${cli ? "cli" : "ffi"} deadlineSent=yes capability=1`,
          );
        } finally {
          await Deno.remove(dir, { recursive: true });
        }
      },
    });
  }
}

Deno.test({
  name:
    "native worker omits unsupported deadlines and reports the legacy contract",
  ignore: Deno.build.os === "windows", // POSIX C ABI fixture.
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "native-worker-legacy-" });
    try {
      const fixture = await nativeProcessFixture(dir);
      const capabilities = join(dir, "legacy-capabilities.json");
      await Deno.writeTextFile(
        capabilities,
        JSON.stringify({ abiVersion: 1, version: "0.1.49", capabilities: {} }),
      );
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          "--no-lock",
          "--config",
          fromFileUrl(new URL("deno.json", REPO_ROOT)),
          fromFileUrl(
            new URL("fixtures/WorkerNativeTrain.ts", import.meta.url),
          ),
          "--legacy",
        ],
        env: {
          ...fixture.env,
          TMPDIR: dir,
          NEAT_TEST_NO_WAIT: "1",
          NEAT_TEST_CAPABILITIES: capabilities,
          NEAT_TEST_RESPONSE: fromFileUrl(
            new URL(
              "test/fixtures/native-backprop/ffi-response-legacy.json",
              REPO_ROOT,
            ),
          ),
        },
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(30_000),
      }).output();
      const text = new TextDecoder().decode(output.stdout) +
        new TextDecoder().decode(output.stderr);
      assertEquals(output.code, 0, text);
      assertStringIncludes(text, "WORKER_RESULT_VERIFIED");
      assertStringIncludes(text, "backend=ffi deadlineSent=no capability=none");
      assertStringIncludes(
        text,
        "the per-task deadline is NOT enforced natively",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
