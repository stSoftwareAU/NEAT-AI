/**
 * Issue #3930: the shared `--name=value` readers.
 *
 * A harness that silently defaults a mistyped flag reports numbers for a
 * configuration nobody chose, so the tests that matter here are the refusals.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { intArg, numberArg, stringArg } from "../../scripts/lib/cliArgs.ts";

Deno.test("cli args - a present flag is read, an absent one is undefined", () => {
  const args = [
    "--archive=/tmp/a.jsonl",
    "--provenance=production",
    "--seed=7",
  ];
  assertEquals(stringArg(args, "archive"), "/tmp/a.jsonl");
  assertEquals(stringArg(args, "provenance"), "production");
  assertEquals(stringArg(args, "missing"), undefined);
  // A value containing '=' survives intact.
  assertEquals(stringArg(["--label=a=b"], "label"), "a=b");
});

Deno.test("cli args - numbers fall back only when the flag is absent", () => {
  assertEquals(numberArg(["--gap=1e-4"], "gap", 1), 1e-4);
  assertEquals(numberArg([], "gap", 0.5), 0.5);
  assertThrows(
    () => numberArg(["--gap=wide"], "gap", 1),
    Error,
    "not a number",
  );
});

Deno.test("cli args - integers refuse anything that is not a positive integer", () => {
  assertEquals(intArg(["--runs=6"], "runs", 3), 6);
  assertEquals(intArg([], "runs", 3), 3);
  for (const bad of ["0", "-2", "2.5", "many"]) {
    assertThrows(
      () => intArg([`--runs=${bad}`], "runs", 3),
      Error,
      "positive integer",
    );
  }
});
