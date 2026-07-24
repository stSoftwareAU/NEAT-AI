/**
 * Unit tests for {@link serialiseOptionsEcho} (Issue #3422, revised by Issue
 * #3427): the caller-supplied evolve options echoed onto the run-level result
 * must round-trip serialisable values, skip `undefined`, drop any
 * non-serialisable option entirely (no marker), and record the `creatures`
 * seed array as its count.
 */

import { assertEquals } from "@std/assert";
import { serialiseOptionsEcho } from "@creature/EvolveOptionsEcho.ts";

Deno.test("serialiseOptionsEcho - echoes serialisable options as passed", () => {
  const echo = serialiseOptionsEcho({
    populationSize: 100,
    iterations: 50,
    targetError: 0,
    costName: "MSE",
    outputRanges: [{ min: 0, max: 1 }],
  });

  assertEquals(echo, {
    populationSize: 100,
    iterations: 50,
    targetError: 0,
    costName: "MSE",
    outputRanges: [{ min: 0, max: 1 }],
  });
});

Deno.test("serialiseOptionsEcho - drops function options entirely", () => {
  const echo = serialiseOptionsEcho({
    populationSize: 10,
    onTrainingEvent: () => {},
    customCost: function cost() {
      return 0;
    },
  });

  assertEquals(echo, { populationSize: 10 });
  assertEquals(Object.hasOwn(echo, "onTrainingEvent"), false);
  assertEquals(Object.hasOwn(echo, "customCost"), false);
});

Deno.test("serialiseOptionsEcho - drops non-serialisable (circular) values", () => {
  const circular: Record<string, unknown> = { name: "loop" };
  circular.self = circular;

  const echo = serialiseOptionsEcho({ populationSize: 5, circular });

  assertEquals(echo, { populationSize: 5 });
  assertEquals(Object.hasOwn(echo, "circular"), false);
});

Deno.test("serialiseOptionsEcho - echoes the creatures seed array as its count", () => {
  const echo = serialiseOptionsEcho({
    creatureStore: ".creatures",
    creatures: [{ id: "a" }, { id: "b" }, { id: "c" }],
  });

  assertEquals(echo, { creatureStore: ".creatures", creatures: 3 });
});

Deno.test("serialiseOptionsEcho - echoes an empty creatures array as 0", () => {
  const echo = serialiseOptionsEcho({ creatures: [] });

  assertEquals(echo, { creatures: 0 });
});

Deno.test("serialiseOptionsEcho - omits creatures when the caller supplies none", () => {
  const echo = serialiseOptionsEcho({ populationSize: 20 });

  assertEquals(Object.hasOwn(echo, "creatures"), false);
});

Deno.test("serialiseOptionsEcho - skips undefined values", () => {
  const echo = serialiseOptionsEcho({
    populationSize: 20,
    threads: undefined,
  });

  assertEquals(Object.hasOwn(echo, "threads"), false);
  assertEquals(echo.populationSize, 20);
});

Deno.test("serialiseOptionsEcho - empty result for undefined input", () => {
  assertEquals(serialiseOptionsEcho(undefined), {});
});

Deno.test("serialiseOptionsEcho - deep-clones nested values (no shared reference)", () => {
  const source = { nested: { list: [1, 2, 3] } };
  const echo = serialiseOptionsEcho(source);

  (echo.nested as { list: number[] }).list.push(4);
  // Mutating the echo must not affect the caller's original options.
  assertEquals(source.nested.list, [1, 2, 3]);
});
