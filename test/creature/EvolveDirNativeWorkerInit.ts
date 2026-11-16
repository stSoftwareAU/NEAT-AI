import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const ROOT = new URL("../../", import.meta.url);
for (const mode of ["native", "wasm-direct", "wasm-fallback"]) {
  Deno.test(`evolveDir worker init: ${mode}`, async () => {
    const dir = await Deno.makeTempDir({ prefix: "native-init-" });
    try {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          "--no-lock",
          "--config",
          fromFileUrl(new URL("deno.json", ROOT)),
          fromFileUrl(
            new URL("fixtures/EvolveDirWorkerInitFailure.ts", import.meta.url),
          ),
          ...(mode === "native" ? ["--native"] : []),
          ...(mode === "wasm-fallback" ? ["--parallel"] : []),
        ],
        env: {
          TMPDIR: dir,
          NEAT_AI_BACKPROP_ENABLED: mode === "native" ? "1" : "0",
        },
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(30_000),
      }).output();
      const text = new TextDecoder().decode(output.stdout) +
        new TextDecoder().decode(output.stderr);
      assertEquals(output.code, 0, text);
      assertStringIncludes(
        text,
        mode === "native" ? "NATIVE_INIT_REFUSED" : "WASM_RUN_COMPLETE",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}
