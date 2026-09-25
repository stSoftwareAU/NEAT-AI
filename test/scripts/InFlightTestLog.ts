import { assertEquals, assertStringIncludes } from "@std/assert";
import { beginInFlight, endInFlight } from "../_inFlightTestLog.ts";

/**
 * An environment holding only `NEAT_AI_IN_FLIGHT_DIR`. Injected rather than
 * set on the process: `deno test --parallel` shares one environment across
 * every test file, so setting (or deleting) the variable here would redirect
 * or silence every sibling case's in-flight record (Issue #4034).
 */
function inFlightEnv(dir: string | undefined) {
  return (key: string) => key === "NEAT_AI_IN_FLIGHT_DIR" ? dir : undefined;
}

Deno.test({
  name: "in-flight log leaves a name file until the test finishes",
  permissions: { read: true, write: true },
  fn: () => {
    const dir = Deno.makeTempDirSync({ prefix: "neat-in-flight-" });
    try {
      const handle = beginInFlight("evolve_AND_gate", inFlightEnv(dir));
      const files = [...Deno.readDirSync(dir)].filter((entry) => entry.isFile);
      assertEquals(files.length, 1, "expected one in-flight name file");
      const text = Deno.readTextFileSync(`${dir}/${files[0].name}`);
      assertStringIncludes(text, "evolve_AND_gate");
      assertStringIncludes(text, `pid=${Deno.pid}`);
      endInFlight(handle);
      assertEquals(
        [...Deno.readDirSync(dir)].length,
        0,
        "finished tests must remove their in-flight name file",
      );
    } finally {
      try {
        Deno.removeSync(dir, { recursive: true });
      } catch {
        // Ignore cleanup errors.
      }
    }
  },
});

Deno.test({
  name: "in-flight log is a no-op when the directory env is unset",
  permissions: { read: true, write: true },
  fn: () => {
    const handle = beginInFlight("should-not-write", inFlightEnv(undefined));
    assertEquals(handle, undefined);
    endInFlight(handle);
  },
});

Deno.test({
  name: "in-flight log is a no-op when the directory env is blank",
  permissions: { read: true, write: true },
  fn: () => {
    const handle = beginInFlight("should-not-write", inFlightEnv("   "));
    assertEquals(handle, undefined);
  },
});

Deno.test({
  name:
    "in-flight hook does not fail tests that omit env and write permissions",
  permissions: { read: true },
  fn: () => {
    assertEquals(1 + 1, 2);
  },
});
