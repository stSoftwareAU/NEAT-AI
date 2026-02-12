import { assert, assertEquals } from "@std/assert";
import { Neat } from "../../src/NEAT/Neat.ts";

/**
 * Unit tests for Neat.deepCloneAndShuffle static method.
 *
 * Issue #1397: Verify the deep clone and shuffle utility correctly
 * clones elements, shuffles them, and handles edge cases.
 */

Deno.test("deepCloneAndShuffle: returns empty array for empty input", () => {
  const result = Neat.deepCloneAndShuffle([]);
  assertEquals(result.length, 0, "Should return empty array");
});

Deno.test("deepCloneAndShuffle: returns single element for single-element input", () => {
  const input = [{ value: 42 }];
  const result = Neat.deepCloneAndShuffle(input);

  assertEquals(result.length, 1, "Should have 1 element");
  assertEquals(result[0].value, 42, "Value should be 42");
});

Deno.test("deepCloneAndShuffle: deep clones objects (not same reference)", () => {
  const original = { nested: { value: "hello" } };
  const input = [original];
  const result = Neat.deepCloneAndShuffle(input);

  assertEquals(result[0].nested.value, "hello", "Value should match");
  // Use strict reference check (assertNotEquals does deep comparison)
  assert(
    result[0] !== original,
    "Should not be same reference",
  );
  assert(
    result[0].nested !== original.nested,
    "Nested object should not be same reference",
  );
});

Deno.test("deepCloneAndShuffle: modifying clone does not affect original", () => {
  const input = [{ a: 1 }, { a: 2 }, { a: 3 }];
  const result = Neat.deepCloneAndShuffle(input);

  // Modify the cloned result
  result[0].a = 999;

  // Original should be unchanged
  assertEquals(input[0].a, 1, "Original should not be modified");
  assertEquals(input[1].a, 2, "Original should not be modified");
  assertEquals(input[2].a, 3, "Original should not be modified");
});

Deno.test("deepCloneAndShuffle: preserves all elements", () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const result = Neat.deepCloneAndShuffle(input);

  assertEquals(result.length, input.length, "Length should match");

  // Sort both to compare contents
  const sortedInput = [...input].sort((a, b) => a - b);
  const sortedResult = [...result].sort((a, b) => a - b);
  assertEquals(
    sortedResult,
    sortedInput,
    "Should contain same elements",
  );
});

Deno.test("deepCloneAndShuffle: shuffles array (statistical test)", () => {
  // With 20 elements, the probability of a shuffle producing the exact
  // same order is 1/20! which is effectively zero. Run multiple times
  // to ensure at least one is different.
  const input = Array.from({ length: 20 }, (_, i) => i);
  let foundDifferentOrder = false;

  for (let attempt = 0; attempt < 10; attempt++) {
    const result = Neat.deepCloneAndShuffle(input);
    const isSameOrder = result.every((val, idx) => val === input[idx]);
    if (!isSameOrder) {
      foundDifferentOrder = true;
      break;
    }
  }

  assertEquals(
    foundDifferentOrder,
    true,
    "Shuffle should produce a different order at least once in 10 attempts",
  );
});

Deno.test("deepCloneAndShuffle: handles arrays of complex objects", () => {
  const input = [
    { name: "alpha", data: [1, 2, 3] },
    { name: "beta", data: [4, 5, 6] },
    { name: "gamma", data: [7, 8, 9] },
  ];

  const result = Neat.deepCloneAndShuffle(input);

  assertEquals(result.length, 3, "Should have 3 elements");

  // Verify all names are present
  const names = result.map((r) => r.name).sort();
  assertEquals(
    names,
    ["alpha", "beta", "gamma"],
    "All names should be present",
  );

  // Verify data arrays are deep cloned (strict reference check)
  for (const item of result) {
    const originalItem = input.find((i) => i.name === item.name);
    if (originalItem) {
      assert(
        item.data !== originalItem.data,
        `Data array for ${item.name} should be a new reference`,
      );
    }
  }
});
