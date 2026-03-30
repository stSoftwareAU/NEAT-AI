/**
 * Unit tests for TagUtils - tag deduplication and merging.
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import {
  dedupeTagsByNameValue,
  mergeTagsByNameValue,
} from "@utils/TagUtils.ts";

// --- dedupeTagsByNameValue ---

Deno.test("dedupeTagsByNameValue returns undefined for undefined input", () => {
  assertEquals(dedupeTagsByNameValue(undefined), undefined);
});

Deno.test("dedupeTagsByNameValue returns undefined for empty array", () => {
  assertEquals(dedupeTagsByNameValue([]), undefined);
});

Deno.test("dedupeTagsByNameValue keeps unique tags", () => {
  const tags = [
    { name: "colour", value: "red" },
    { name: "colour", value: "blue" },
  ];
  const result = dedupeTagsByNameValue(tags);
  assertEquals(result?.length, 2);
});

Deno.test("dedupeTagsByNameValue removes duplicate tags", () => {
  const tags = [
    { name: "colour", value: "red" },
    { name: "colour", value: "red" },
    { name: "colour", value: "blue" },
  ];
  const result = dedupeTagsByNameValue(tags);
  assertEquals(result?.length, 2);
});

Deno.test("dedupeTagsByNameValue preserves first occurrence order", () => {
  const tags = [
    { name: "a", value: "1" },
    { name: "b", value: "2" },
    { name: "a", value: "1" },
  ];
  const result = dedupeTagsByNameValue(tags)!;
  assertEquals(result[0].name, "a");
  assertEquals(result[1].name, "b");
});

Deno.test("dedupeTagsByNameValue treats different values as distinct", () => {
  const tags = [
    { name: "version", value: "1" },
    { name: "version", value: "2" },
  ];
  const result = dedupeTagsByNameValue(tags);
  assertEquals(result?.length, 2);
});

// --- mergeTagsByNameValue ---

Deno.test("mergeTagsByNameValue returns undefined when both undefined", () => {
  assertEquals(mergeTagsByNameValue(undefined, undefined), undefined);
});

Deno.test("mergeTagsByNameValue returns b when a is undefined", () => {
  const b = [{ name: "x", value: "1" }];
  const result = mergeTagsByNameValue(undefined, b);
  assertEquals(result?.length, 1);
  assertEquals(result?.[0].name, "x");
});

Deno.test("mergeTagsByNameValue returns a when b is undefined", () => {
  const a = [{ name: "x", value: "1" }];
  const result = mergeTagsByNameValue(a, undefined);
  assertEquals(result?.length, 1);
  assertEquals(result?.[0].name, "x");
});

Deno.test("mergeTagsByNameValue merges and deduplicates", () => {
  const a = [{ name: "colour", value: "red" }];
  const b = [
    { name: "colour", value: "red" },
    { name: "colour", value: "blue" },
  ];
  const result = mergeTagsByNameValue(a, b);
  assertEquals(result?.length, 2);
});

Deno.test("mergeTagsByNameValue handles empty arrays as undefined", () => {
  const a = [{ name: "x", value: "1" }];
  const result = mergeTagsByNameValue(a, []);
  assertEquals(result?.length, 1);
});
