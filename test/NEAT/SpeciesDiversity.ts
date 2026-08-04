import { assertEquals } from "@std/assert";
import { computeSpeciesDiversity } from "@neat/SpeciesDiversity.ts";

Deno.test("computeSpeciesDiversity - single species", () => {
  const diversity = computeSpeciesDiversity(1, 50);
  assertEquals(diversity, 1 / 50);
});

Deno.test("computeSpeciesDiversity - all unique species", () => {
  const diversity = computeSpeciesDiversity(50, 50);
  assertEquals(diversity, 1);
});

Deno.test("computeSpeciesDiversity - population of 1", () => {
  const diversity = computeSpeciesDiversity(1, 1);
  assertEquals(diversity, 1);
});

Deno.test("computeSpeciesDiversity - more species than population capped at 1", () => {
  const diversity = computeSpeciesDiversity(100, 50);
  assertEquals(diversity, 1);
});
