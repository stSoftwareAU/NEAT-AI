/**
 * Unit tests for {@link serialiseOptionsEcho} (Issue #3422): the caller-supplied
 * evolve options echoed onto the run-level result must round-trip serialisable
 * values, skip `undefined`, and record non-serialisable options by name with a
 * marker rather than dropping them silently.
 */

import { assertEquals } from "@std/assert";
import {
  OPTION_FUNCTION_MARKER,
  OPTION_UNSERIALISABLE_MARKER,
  serialiseOptionsEcho,
} from "@creature/EvolveOptionsEcho.ts";

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

Deno.test("serialiseOptionsEcho - records function options by name with marker", () => {
  const echo = serialiseOptionsEcho({
    populationSize: 10,
    onTrainingEvent: () => {},
    customCost: function cost() {
      return 0;
    },
  });

  assertEquals(echo.populationSize, 10);
  assertEquals(echo.onTrainingEvent, OPTION_FUNCTION_MARKER);
  assertEquals(echo.customCost, OPTION_FUNCTION_MARKER);
});

Deno.test("serialiseOptionsEcho - marks non-serialisable (circular) values", () => {
  const circular: Record<string, unknown> = { name: "loop" };
  circular.self = circular;

  const echo = serialiseOptionsEcho({ populationSize: 5, circular });

  assertEquals(echo.populationSize, 5);
  assertEquals(echo.circular, OPTION_UNSERIALISABLE_MARKER);
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
