import { assertEquals, assertThrows } from "@std/assert";
import { appendAll, insertAll } from "@utils/ArrayAppend.ts";

Deno.test("appendAll - happy path appends in order after existing contents", () => {
  const target = [1, 2, 3];
  appendAll(target, [4, 5, 6]);
  assertEquals(target, [1, 2, 3, 4, 5, 6]);
});

Deno.test("appendAll - empty items is a no-op", () => {
  const target = ["a", "b"];
  appendAll(target, []);
  assertEquals(target, ["a", "b"]);
});

Deno.test("appendAll - empty target receives all items in order", () => {
  const target: number[] = [];
  appendAll(target, [10, 20, 30]);
  assertEquals(target, [10, 20, 30]);
});

Deno.test("appendAll - large batch exceeds the spread limit (regression #2897)", () => {
  // Size chosen to exceed V8's spread-into-arguments limit. The canary below
  // proves the size is genuinely over the limit; if a future V8 raises it, the
  // canary fails loudly so the size can be revisited rather than passing for
  // the wrong reason.
  const SIZE = 200_000;
  const bigArray = new Array(SIZE);
  for (let i = 0; i < SIZE; i++) bigArray[i] = i;

  // Canary: the original spread-push crashes at this scale.
  const canary: number[] = [];
  assertThrows(() => canary.push(...bigArray), RangeError);

  // Fix: appendAll appends the same batch without throwing, preserving the
  // pre-existing front element, length, and order.
  const target = [-1];
  appendAll(target, bigArray);
  assertEquals(target.length, SIZE + 1);
  assertEquals(target[0], -1);
  assertEquals(target[1], 0);
  assertEquals(target[SIZE], SIZE - 1);
});

Deno.test("insertAll - inserts in order at the given index", () => {
  const target = [1, 2, 5, 6];
  insertAll(target, 2, [3, 4]);
  assertEquals(target, [1, 2, 3, 4, 5, 6]);
});

Deno.test("insertAll - mutates the same array object in place", () => {
  const target = [1, 4];
  const alias = target;
  insertAll(target, 1, [2, 3]);
  // The alias still references the mutated array (no reassignment).
  assertEquals(alias, [1, 2, 3, 4]);
  assertEquals(alias, target);
});

Deno.test("insertAll - empty items is a no-op", () => {
  const target = ["a", "b"];
  insertAll(target, 1, []);
  assertEquals(target, ["a", "b"]);
});

Deno.test("insertAll - index 0 prepends, index >= length appends", () => {
  const front = [3, 4];
  insertAll(front, 0, [1, 2]);
  assertEquals(front, [1, 2, 3, 4]);

  const back = [1, 2];
  insertAll(back, 99, [3, 4]); // clamped to length
  assertEquals(back, [1, 2, 3, 4]);
});

Deno.test("insertAll - large batch exceeds the splice spread limit (regression #2900)", () => {
  const SIZE = 200_000;
  const bigArray = new Array(SIZE);
  for (let i = 0; i < SIZE; i++) bigArray[i] = i;

  // Canary: the original splice-spread crashes at this scale.
  const canary = [-1, -2];
  assertThrows(() => canary.splice(1, 0, ...bigArray), RangeError);

  // Fix: insertAll inserts the same batch without throwing, preserving the
  // surrounding elements and the inserted order.
  const target = [-1, -2];
  insertAll(target, 1, bigArray);
  assertEquals(target.length, SIZE + 2);
  assertEquals(target[0], -1);
  assertEquals(target[1], 0);
  assertEquals(target[SIZE], SIZE - 1);
  assertEquals(target[SIZE + 1], -2);
});
