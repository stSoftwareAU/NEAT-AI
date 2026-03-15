import { assertEquals, assertNotEquals } from "@std/assert";
import {
  findActivationFunction,
  type FunctionCache,
} from "../../src/optimize/FunctionCache.ts";

Deno.test("findActivationFunction - returns undefined on first call (cache miss)", () => {
  const cache: FunctionCache = { key: "" };
  const result = findActivationFunction("const x = 1;", cache);

  assertEquals(result, undefined);
  assertNotEquals(cache.key, "", "Cache key should be set after first call");
});

Deno.test("findActivationFunction - returns cached function on matching body", () => {
  const cache: FunctionCache = { key: "" };
  const body = "const x = 1;";

  // First call sets key but returns undefined
  findActivationFunction(body, cache);

  // Set a mock function in the cache
  const mockFn = () => ({ activation: 1, value: 0 });
  cache.function = mockFn;

  // Second call with same body should return the cached function
  const result = findActivationFunction(body, cache);
  assertEquals(result, mockFn);
});

Deno.test("findActivationFunction - clears function on different body", () => {
  const cache: FunctionCache = { key: "" };
  const body1 = "const x = 1;";
  const body2 = "const y = 2;";

  // First call
  findActivationFunction(body1, cache);
  const key1 = cache.key;
  cache.function = () => ({ activation: 1, value: 0 });

  // Second call with different body — should invalidate
  const result = findActivationFunction(body2, cache);
  assertEquals(result, undefined);
  assertNotEquals(cache.key, key1, "Key should change for different body");
  assertEquals(cache.function, undefined);
});

Deno.test("findActivationFunction - suffix affects cache key", () => {
  const cache1: FunctionCache = { key: "" };
  const cache2: FunctionCache = { key: "" };
  const body = "const x = 1;";

  findActivationFunction(body, cache1, "LOGISTIC");
  findActivationFunction(body, cache2, "IDENTITY");

  assertNotEquals(
    cache1.key,
    cache2.key,
    "Different suffixes should produce different keys",
  );
});

Deno.test("findActivationFunction - same body without and with suffix produces different keys", () => {
  const cache1: FunctionCache = { key: "" };
  const cache2: FunctionCache = { key: "" };
  const body = "const x = 1;";

  findActivationFunction(body, cache1);
  findActivationFunction(body, cache2, "LOGISTIC");

  assertNotEquals(
    cache1.key,
    cache2.key,
    "No suffix vs suffix should produce different keys",
  );
});

Deno.test("findActivationFunction - generates deterministic UUID keys", () => {
  const cache1: FunctionCache = { key: "" };
  const cache2: FunctionCache = { key: "" };
  const body = "const x = 1;";

  findActivationFunction(body, cache1);
  findActivationFunction(body, cache2);

  assertEquals(cache1.key, cache2.key, "Same body should produce same key");
});
