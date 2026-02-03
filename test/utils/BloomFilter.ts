/**
 * Test suite for BloomFilter class (Issue #1292).
 *
 * The BloomFilter provides a probabilistic data structure for fast duplicate
 * detection during de-duplication. It can quickly determine if an element is
 * definitely NOT in a set, while allowing for a small false positive rate.
 *
 * Key features tested:
 * - Basic add and mayContain operations
 * - False negative guarantee (no false negatives)
 * - False positive rate within expected bounds
 * - Clear operation resets state
 * - Optimal hash count calculation
 */
import {
  assert,
  assertEquals,
  assertFalse,
  assertGreater,
  assertLessOrEqual,
} from "@std/assert";
import { BloomFilter } from "../../src/utils/BloomFilter.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("BloomFilter - basic construction", () => {
  // Default parameters
  const filter = new BloomFilter();
  assert(filter, "BloomFilter should be created");

  // Custom parameters
  const customFilter = new BloomFilter(1024, 5);
  assert(customFilter, "BloomFilter with custom parameters should be created");
});

Deno.test("BloomFilter - add and mayContain basic functionality", () => {
  const filter = new BloomFilter(1024, 5);

  // Initially should not contain any items
  assertFalse(filter.mayContain("test-key-1"));
  assertFalse(filter.mayContain("test-key-2"));

  // After adding, should definitely contain the item
  filter.add("test-key-1");
  assert(filter.mayContain("test-key-1"), "Should contain added item");

  // Adding second item
  filter.add("test-key-2");
  assert(filter.mayContain("test-key-1"), "First item should still be found");
  assert(filter.mayContain("test-key-2"), "Second item should be found");
});

Deno.test("BloomFilter - no false negatives", () => {
  const filter = new BloomFilter(8192, 7);
  const items: string[] = [];

  // Add 100 random items
  for (let i = 0; i < 100; i++) {
    const item = `item-${i}-${Math.random().toString(36).substring(7)}`;
    items.push(item);
    filter.add(item);
  }

  // All added items must be found (no false negatives)
  for (const item of items) {
    assert(
      filter.mayContain(item),
      `No false negatives: ${item} should be found`,
    );
  }
});

Deno.test("BloomFilter - false positive rate within expected bounds", () => {
  // Create a filter designed for 1000 items with 1% false positive rate
  const expectedItems = 1000;
  const targetFalsePositiveRate = 0.01;

  // Calculate optimal size: m = -n * ln(p) / (ln(2)^2)
  const optimalSize = Math.ceil(
    -expectedItems * Math.log(targetFalsePositiveRate) /
      (Math.LN2 * Math.LN2),
  );
  // Calculate optimal hash count: k = (m/n) * ln(2)
  const optimalHashCount = Math.round(
    (optimalSize / expectedItems) * Math.LN2,
  );

  const filter = new BloomFilter(optimalSize, optimalHashCount);

  // Add items
  const addedItems = new Set<string>();
  for (let i = 0; i < expectedItems; i++) {
    const item = `added-item-${i}`;
    addedItems.add(item);
    filter.add(item);
  }

  // Test with items that were NOT added
  let falsePositives = 0;
  const testCount = 10000;
  for (let i = 0; i < testCount; i++) {
    const testItem = `test-item-not-added-${i}`;
    if (!addedItems.has(testItem) && filter.mayContain(testItem)) {
      falsePositives++;
    }
  }

  const actualFalsePositiveRate = falsePositives / testCount;

  // Allow for some variance - should be below 3% (3x target) with high probability
  assertLessOrEqual(
    actualFalsePositiveRate,
    0.03,
    `False positive rate ${actualFalsePositiveRate} should be close to target ${targetFalsePositiveRate}`,
  );
});

Deno.test("BloomFilter - clear resets state", () => {
  const filter = new BloomFilter(1024, 5);

  // Add items
  filter.add("item-1");
  filter.add("item-2");
  filter.add("item-3");

  // Verify items are present
  assert(filter.mayContain("item-1"));
  assert(filter.mayContain("item-2"));
  assert(filter.mayContain("item-3"));

  // Clear the filter
  filter.clear();

  // Items should no longer be found
  assertFalse(filter.mayContain("item-1"), "item-1 should be cleared");
  assertFalse(filter.mayContain("item-2"), "item-2 should be cleared");
  assertFalse(filter.mayContain("item-3"), "item-3 should be cleared");
});

Deno.test("BloomFilter - works with UUID-like strings", () => {
  const filter = new BloomFilter(8192, 7);

  // Test with realistic UUID strings
  const uuids = [
    "843dc7df-f60b-47f6-823d-2992e0a4295c",
    "a1b2c3d4-e5f6-47a8-9b0c-d1e2f3a4b5c6",
    "12345678-1234-5678-1234-567812345678",
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  ];

  for (const uuid of uuids) {
    filter.add(uuid);
  }

  // All UUIDs should be found
  for (const uuid of uuids) {
    assert(filter.mayContain(uuid), `UUID ${uuid} should be found`);
  }

  // A different UUID should likely not be found (could be false positive)
  const otherUUID = "99999999-8888-7777-6666-555555555555";
  // Note: This could be a false positive, so we just check it doesn't crash
  filter.mayContain(otherUUID);
});

Deno.test("BloomFilter - optimal parameters calculation", () => {
  // Test the static method for calculating optimal parameters
  const params = BloomFilter.optimalParameters(1000, 0.01);

  assertGreater(params.size, 0, "Size should be positive");
  assertGreater(params.hashCount, 0, "Hash count should be positive");
  assertLessOrEqual(params.hashCount, 20, "Hash count should be reasonable");
});

Deno.test("BloomFilter - handles empty and special strings", () => {
  const filter = new BloomFilter(1024, 5);

  // Empty string
  filter.add("");
  assert(filter.mayContain(""), "Empty string should be found");

  // String with special characters
  filter.add("key-with-special-chars!@#$%^&*()");
  assert(
    filter.mayContain("key-with-special-chars!@#$%^&*()"),
    "Special chars should work",
  );

  // Very long string
  const longString = "a".repeat(10000);
  filter.add(longString);
  assert(filter.mayContain(longString), "Long string should work");
});

Deno.test("BloomFilter - size getter returns configured size", () => {
  const filter = new BloomFilter(2048, 5);
  assertEquals(filter.size, 2048, "Size should match configured value");
});

Deno.test("BloomFilter - count getter tracks added items", () => {
  const filter = new BloomFilter(1024, 5);

  assertEquals(filter.count, 0, "Initial count should be 0");

  filter.add("item-1");
  assertEquals(filter.count, 1, "Count should be 1 after first add");

  filter.add("item-2");
  assertEquals(filter.count, 2, "Count should be 2 after second add");

  // Adding same item again should not increment count (optional behaviour)
  // but may still be counted depending on implementation

  filter.clear();
  assertEquals(filter.count, 0, "Count should be 0 after clear");
});

Deno.test("BloomFilter - factory method creates optimally sized filter", () => {
  // Create filter for 500 items with 1% false positive rate
  const filter = BloomFilter.create(500, 0.01);

  assert(filter, "Factory method should create filter");

  // Add items and verify they're found
  for (let i = 0; i < 500; i++) {
    filter.add(`item-${i}`);
  }

  // All added items should be found
  for (let i = 0; i < 500; i++) {
    assert(filter.mayContain(`item-${i}`), `item-${i} should be found`);
  }
});
