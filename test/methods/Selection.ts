/**
 * Unit tests for Selection strategies.
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import { Selection } from "../../src/methods/Selection.ts";

Deno.test("FITNESS_PROPORTIONATE has correct name", () => {
  assertEquals(Selection.FITNESS_PROPORTIONATE.name, "FITNESS_PROPORTIONATE");
});

Deno.test("POWER has correct name and default power", () => {
  assertEquals(Selection.POWER.name, "POWER");
  assertEquals(Selection.POWER.power, 4);
});

Deno.test("TOURNAMENT has correct name and defaults", () => {
  assertEquals(Selection.TOURNAMENT.name, "TOURNAMENT");
  assertEquals(Selection.TOURNAMENT.size, 5);
  assertEquals(Selection.TOURNAMENT.probability, 0.5);
});

Deno.test("Selection strategies are distinct objects", () => {
  assertEquals(
    Selection.FITNESS_PROPORTIONATE.name !== Selection.POWER.name,
    true,
  );
  assertEquals(
    Selection.POWER.name !== Selection.TOURNAMENT.name,
    true,
  );
});
