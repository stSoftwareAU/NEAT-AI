/**
 * Unit tests for DenseNumberMap.
 *
 * Issue #1407: Targeted unit tests for architecture core data structures.
 *
 * DenseNumberMap is a TypedArray-backed Map-like structure optimised for
 * dense integer keys mapping to numbers (Issue #1041).
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import { DenseNumberMap } from "../../src/architecture/DenseNumberMap.ts";

Deno.test("DenseNumberMap - default construction creates empty map", () => {
  const map = new DenseNumberMap();
  assertEquals(map.has(0), false);
  assertEquals(map.get(0), undefined);
});

Deno.test("DenseNumberMap - custom initial capacity", () => {
  const map = new DenseNumberMap(4);
  // Should work within capacity
  map.set(0, 10);
  map.set(3, 40);
  assertEquals(map.get(0), 10);
  assertEquals(map.get(3), 40);
});

Deno.test("DenseNumberMap - set and get at index 0", () => {
  const map = new DenseNumberMap();
  map.set(0, 42);
  assertEquals(map.get(0), 42);
  assertEquals(map.has(0), true);
});

Deno.test("DenseNumberMap - set and get multiple indices", () => {
  const map = new DenseNumberMap(8);
  map.set(0, 1.5);
  map.set(3, 3.14);
  map.set(7, -2.0);

  assertEquals(map.get(0), 1.5);
  assertEquals(map.get(3), 3.14);
  assertEquals(map.get(7), -2.0);
});

Deno.test("DenseNumberMap - get returns undefined for unset index", () => {
  const map = new DenseNumberMap(8);
  map.set(0, 10);
  assertEquals(map.get(1), undefined);
  assertEquals(map.get(5), undefined);
});

Deno.test("DenseNumberMap - get returns undefined for out-of-bounds index", () => {
  const map = new DenseNumberMap(4);
  assertEquals(map.get(100), undefined);
});

Deno.test("DenseNumberMap - has returns false for unset indices", () => {
  const map = new DenseNumberMap(8);
  assertEquals(map.has(0), false);
  assertEquals(map.has(5), false);
});

Deno.test("DenseNumberMap - has returns false for out-of-bounds index", () => {
  const map = new DenseNumberMap(4);
  assertEquals(map.has(100), false);
});

Deno.test("DenseNumberMap - has returns true after set", () => {
  const map = new DenseNumberMap();
  map.set(5, 99);
  assertEquals(map.has(5), true);
});

Deno.test("DenseNumberMap - overwrite existing value", () => {
  const map = new DenseNumberMap();
  map.set(3, 10);
  assertEquals(map.get(3), 10);
  map.set(3, 20);
  assertEquals(map.get(3), 20);
  assertEquals(map.has(3), true);
});

Deno.test("DenseNumberMap - auto-grow on large index", () => {
  const map = new DenseNumberMap(2);
  // Setting at index 100 should trigger growth
  map.set(100, 7.77);
  assertEquals(map.get(100), 7.77);
  assertEquals(map.has(100), true);
});

Deno.test("DenseNumberMap - preserves data after growth", () => {
  const map = new DenseNumberMap(4);
  map.set(0, 1);
  map.set(1, 2);
  map.set(2, 3);

  // Trigger growth
  map.set(50, 50);

  // Original values should still be present
  assertEquals(map.get(0), 1);
  assertEquals(map.get(1), 2);
  assertEquals(map.get(2), 3);
  assertEquals(map.get(50), 50);
});

Deno.test("DenseNumberMap - multiple growths", () => {
  const map = new DenseNumberMap(2);
  map.set(0, 10);
  map.set(5, 50); // First growth
  map.set(20, 200); // Second growth

  assertEquals(map.get(0), 10);
  assertEquals(map.get(5), 50);
  assertEquals(map.get(20), 200);
});

Deno.test("DenseNumberMap - clear removes all entries", () => {
  const map = new DenseNumberMap(8);
  map.set(0, 1);
  map.set(3, 2);
  map.set(7, 3);

  map.clear();

  assertEquals(map.has(0), false);
  assertEquals(map.has(3), false);
  assertEquals(map.has(7), false);
  assertEquals(map.get(0), undefined);
  assertEquals(map.get(3), undefined);
  assertEquals(map.get(7), undefined);
});

Deno.test("DenseNumberMap - reuse after clear", () => {
  const map = new DenseNumberMap(8);
  map.set(0, 100);
  map.clear();
  map.set(0, 200);

  assertEquals(map.get(0), 200);
  assertEquals(map.has(0), true);
});

Deno.test("DenseNumberMap - set returns this for chaining", () => {
  const map = new DenseNumberMap();
  const returned = map.set(0, 1).set(1, 2).set(2, 3);

  assertStrictEquals(returned, map);
  assertEquals(map.get(0), 1);
  assertEquals(map.get(1), 2);
  assertEquals(map.get(2), 3);
});

Deno.test("DenseNumberMap - stores zero correctly", () => {
  const map = new DenseNumberMap();
  map.set(5, 0);

  assertEquals(map.has(5), true);
  assertEquals(map.get(5), 0);
});

Deno.test("DenseNumberMap - stores negative values", () => {
  const map = new DenseNumberMap();
  map.set(0, -42.5);

  assertEquals(map.get(0), -42.5);
});

Deno.test("DenseNumberMap - stores very small values", () => {
  const map = new DenseNumberMap();
  map.set(0, Number.EPSILON);

  assertEquals(map.get(0), Number.EPSILON);
});

Deno.test("DenseNumberMap - minimum initial capacity is 1", () => {
  // Even with 0 initial capacity, should still work
  const map = new DenseNumberMap(0);
  map.set(0, 5);
  assertEquals(map.get(0), 5);
});
