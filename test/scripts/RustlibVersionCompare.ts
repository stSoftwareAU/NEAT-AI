import { assertEquals } from "@std/assert";

/**
 * Tests the _version_ge function from scripts/rustlib.sh by sourcing the
 * script and invoking the function with test data.
 *
 * Issue #1489 - Learnings from NEAT-AI-Discovery runlib.sh.
 */

async function runVersionGe(v1: string, v2: string): Promise<boolean> {
  const cmd = new Deno.Command("bash", {
    args: [
      "-c",
      `source scripts/rustlib.sh && _version_ge "${v1}" "${v2}"`,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code } = await cmd.output();
  return code === 0;
}

Deno.test("_version_ge: equal versions return true", async () => {
  const result = await runVersionGe("1.82.0", "1.82.0");
  assertEquals(result, true);
});

Deno.test("_version_ge: higher major returns true", async () => {
  const result = await runVersionGe("2.0.0", "1.82.0");
  assertEquals(result, true);
});

Deno.test("_version_ge: higher minor returns true", async () => {
  const result = await runVersionGe("1.92.0", "1.82.0");
  assertEquals(result, true);
});

Deno.test("_version_ge: higher patch returns true", async () => {
  const result = await runVersionGe("1.82.1", "1.82.0");
  assertEquals(result, true);
});

Deno.test("_version_ge: lower major returns false", async () => {
  const result = await runVersionGe("0.99.0", "1.82.0");
  assertEquals(result, false);
});

Deno.test("_version_ge: lower minor returns false", async () => {
  const result = await runVersionGe("1.81.0", "1.82.0");
  assertEquals(result, false);
});

Deno.test("_version_ge: lower patch returns false", async () => {
  const result = await runVersionGe("1.82.0", "1.82.1");
  assertEquals(result, false);
});

Deno.test("_version_ge: strips pre-release suffix", async () => {
  const result = await runVersionGe("1.92.0-beta", "1.82.0");
  assertEquals(result, true);
});

Deno.test("_version_ge: short version against long version", async () => {
  const result = await runVersionGe("2.0", "1.82.0");
  assertEquals(result, true);
});
