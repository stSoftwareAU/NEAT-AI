import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

export const REPO_ROOT = new URL("../../../", import.meta.url);

/** Build the ABI fixture; the process tests require a C compiler on macOS/Linux. */
export async function nativeProcessFixture(dir: string): Promise<{
  library: string;
  env: Record<string, string>;
  release: () => Promise<void>;
}> {
  const library = join(
    dir,
    Deno.build.os === "darwin" ? "trainer.dylib" : "trainer.so",
  );
  const compiled = await new Deno.Command("cc", {
    args: [
      Deno.build.os === "darwin" ? "-dynamiclib" : "-shared",
      "-fPIC",
      "-o",
      library,
      fromFileUrl(new URL("fixtures/WedgedNativeTrainer.c", import.meta.url)),
    ],
    stdin: "null",
    stderr: "piped",
  }).output();
  assertEquals(compiled.code, 0, new TextDecoder().decode(compiled.stderr));
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
      NEAT_AI_BACKPROP_ENABLED: "1",
      NEAT_AI_BACKPROP_LIB_PATH: library,
      NEAT_AI_BACKPROP_REQUIRE_FFI: "1",
      NEAT_TEST_CAPABILITIES: fromFileUrl(
        new URL(
          "test/fixtures/native-backprop/capabilities-new.json",
          REPO_ROOT,
        ),
      ),
      NEAT_TEST_RESPONSE: fromFileUrl(
        new URL(
          "test/fixtures/native-backprop/ffi-response-new-completed.json",
          REPO_ROOT,
        ),
      ),
      NEAT_TEST_RELEASE: pipe,
      NEAT_TEST_REQUEST: join(dir, "request.json"),
    },
    release: async () => {
      using file = await Deno.open(pipe, { read: true, write: true });
      await file.write(new Uint8Array([1]));
    },
  };
}
