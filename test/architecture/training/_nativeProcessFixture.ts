import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

export const REPO_ROOT = new URL("../../../", import.meta.url);

/**
 * Build the ABI fixture; the process tests require a C compiler on macOS/Linux.
 *
 * With `legacy` the stand-in is built as the 0.1.49 engine: it exports no
 * `neat_backprop_capabilities` symbol, has no `capabilities` subcommand, and
 * rejects a request carrying `deadlineEpochMs`. `NEAT_TEST_CAPABILITIES` is
 * then omitted from the returned environment.
 */
export async function nativeProcessFixture(
  dir: string,
  cli = false,
  legacy = false,
): Promise<{
  library: string;
  env: Record<string, string>;
  release: () => Promise<void>;
}> {
  dir = await Deno.realPath(dir);
  const library = join(
    dir,
    Deno.build.os === "darwin" ? "trainer.dylib" : "trainer.so",
  );
  const binary = join(dir, "trainer");
  const compiled = await new Deno.Command("cc", {
    args: [
      ...(legacy ? ["-DTRAINER_LEGACY"] : []),
      ...(cli
        ? ["-DTRAINER_CLI"]
        : [Deno.build.os === "darwin" ? "-dynamiclib" : "-shared"]),
      "-fPIC",
      "-o",
      cli ? binary : library,
      fromFileUrl(new URL("fixtures/WedgedNativeTrainer.c", import.meta.url)),
    ],
    stdin: "null",
    stderr: "piped",
  }).output();
  assertEquals(compiled.code, 0, new TextDecoder().decode(compiled.stderr));
  if (cli) {
    await Deno.writeTextFile(
      library,
      "Deliberately unavailable FFI: exercise the CLI.",
    );
  }
  const pipe = join(dir, "release");
  const made = await new Deno.Command("mkfifo", {
    args: [pipe],
    stdin: "null",
    stderr: "piped",
  }).output();
  assertEquals(made.code, 0, new TextDecoder().decode(made.stderr));
  return {
    library,
    env: {
      TMPDIR: dir,
      NEAT_AI_BACKPROP_ENABLED: "1",
      NEAT_AI_BACKPROP_LIB_PATH: library,
      NEAT_AI_BACKPROP_REQUIRE_FFI: cli ? "0" : "1",
      NEAT_AI_BACKPROP_BINARY_PATH: binary,
      ...(legacy ? {} : {
        NEAT_TEST_CAPABILITIES: fromFileUrl(
          new URL(
            "test/fixtures/native-backprop/capabilities-new.json",
            REPO_ROOT,
          ),
        ),
      }),
      NEAT_TEST_RESPONSE: fromFileUrl(
        new URL(
          "test/fixtures/native-backprop/ffi-response-new-completed.json",
          REPO_ROOT,
        ),
      ),
      NEAT_TEST_RELEASE: pipe,
      NEAT_TEST_REQUEST: join(dir, "request.json"),
      NEAT_TEST_STARTED: join(dir, "started"),
    },
    release: async () => {
      using file = await Deno.open(pipe, { read: true, write: true });
      await file.write(new Uint8Array([1]));
    },
  };
}
