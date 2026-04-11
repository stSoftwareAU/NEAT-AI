import { assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";

Deno.test("heavyTaskWorkerCount - defaults to 2", () => {
  const config = createNeatConfig({ threads: 8 });
  assertEquals(config.heavyTaskWorkerCount, 2);
});

Deno.test("heavyTaskWorkerCount - user can override", () => {
  const config = createNeatConfig({ threads: 8, heavyTaskWorkerCount: 3 });
  assertEquals(config.heavyTaskWorkerCount, 3);
});

Deno.test("heavyTaskWorkerCount - accepts string from CLI", () => {
  const config = createNeatConfig({
    threads: 8,
    heavyTaskWorkerCount: "3" as unknown as number,
  });
  assertEquals(config.heavyTaskWorkerCount, 3);
});

Deno.test("heavyTaskWorkerCount - rejects 0 (must be >= 1)", () => {
  assertThrows(
    () => createNeatConfig({ threads: 8, heavyTaskWorkerCount: 0 }),
    Error,
  );
});

Deno.test("heavyTaskWorkerCount - rejects negative values", () => {
  assertThrows(
    () => createNeatConfig({ threads: 8, heavyTaskWorkerCount: -1 }),
    Error,
  );
});

Deno.test("heavyTaskWorkerCount - rejects value >= threads when threads > 2", () => {
  assertThrows(
    () => createNeatConfig({ threads: 4, heavyTaskWorkerCount: 4 }),
    Error,
    "heavyTaskWorkerCount",
  );
});

Deno.test("heavyTaskWorkerCount - rejects value equal to threads when threads > 2", () => {
  assertThrows(
    () => createNeatConfig({ threads: 3, heavyTaskWorkerCount: 3 }),
    Error,
    "heavyTaskWorkerCount",
  );
});

Deno.test("heavyTaskWorkerCount - allows value up to threads - 1 when threads > 2", () => {
  const config = createNeatConfig({ threads: 4, heavyTaskWorkerCount: 3 });
  assertEquals(config.heavyTaskWorkerCount, 3);
});

Deno.test("heavyTaskWorkerCount - skips upper-bound validation when threads <= 2", () => {
  const config = createNeatConfig({ threads: 2, heavyTaskWorkerCount: 2 });
  assertEquals(config.heavyTaskWorkerCount, 2);
});

Deno.test("heavyTaskWorkerCount - works with threads = 1", () => {
  const config = createNeatConfig({ threads: 1 });
  assertEquals(config.heavyTaskWorkerCount, 2);
});

Deno.test("heavyTaskWorkerCount - preserves default behaviour with no options", () => {
  const config = createNeatConfig({});
  assertEquals(config.heavyTaskWorkerCount, 2);
});

Deno.test("heavyTaskWorkerCount - config is frozen after creation", () => {
  const config = createNeatConfig({ threads: 8 });
  assertThrows(
    () => {
      (config as Record<string, unknown>).heavyTaskWorkerCount = 99;
    },
    TypeError,
    "Cannot assign",
  );
});

Deno.test("heavyTaskWorkerCount - must be integer", () => {
  assertThrows(
    () => createNeatConfig({ threads: 8, heavyTaskWorkerCount: 1.5 }),
    Error,
  );
});
