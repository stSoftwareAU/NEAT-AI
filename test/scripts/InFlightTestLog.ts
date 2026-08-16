import { assertEquals, assertStringIncludes } from "@std/assert";
import { beginInFlight, endInFlight } from "../_inFlightTestLog.ts";

Deno.test({
  name: "in-flight log leaves a name file until the test finishes",
  permissions: { env: true, read: true, write: true },
  fn: () => {
    const previous = Deno.env.get("NEAT_AI_IN_FLIGHT_DIR");
    const dir = Deno.makeTempDirSync({ prefix: "neat-in-flight-" });
    try {
      Deno.env.set("NEAT_AI_IN_FLIGHT_DIR", dir);
      const handle = beginInFlight("evolve_AND_gate");
      const files = [...Deno.readDirSync(dir)].filter((entry) => entry.isFile);
      assertEquals(files.length, 1, "expected one in-flight name file");
      const text = Deno.readTextFileSync(`${dir}/${files[0].name}`);
      assertStringIncludes(text, "evolve_AND_gate");
      assertStringIncludes(text, `pid=${Deno.pid}`);
      endInFlight(handle);
      assertEquals(
        [...Deno.readDirSync(dir)].filter((entry) => entry.isFile).length,
        0,
        "finished tests must remove their in-flight name file",
      );
    } finally {
      if (previous === undefined) {
        Deno.env.delete("NEAT_AI_IN_FLIGHT_DIR");
      } else {
        Deno.env.set("NEAT_AI_IN_FLIGHT_DIR", previous);
      }
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
  permissions: { env: true },
  fn: () => {
    const previous = Deno.env.get("NEAT_AI_IN_FLIGHT_DIR");
    try {
      Deno.env.delete("NEAT_AI_IN_FLIGHT_DIR");
      const handle = beginInFlight("should-not-write");
      assertEquals(handle, undefined);
      endInFlight(handle);
    } finally {
      if (previous === undefined) {
        Deno.env.delete("NEAT_AI_IN_FLIGHT_DIR");
      } else {
        Deno.env.set("NEAT_AI_IN_FLIGHT_DIR", previous);
      }
    }
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
