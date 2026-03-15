import { assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { DEFAULT_WASM_CACHE_CONFIG } from "../../src/config/WasmCacheConfig.ts";

Deno.test("WasmCacheConfig - default maxCachedActivations scales with populationSize", () => {
  const config = createNeatConfig({ populationSize: 100 });
  assertEquals(config.wasmCache.maxCachedActivations, 200);
});

Deno.test("WasmCacheConfig - default maxCachedActivations uses default populationSize when not set", () => {
  const config = createNeatConfig({});
  // Default populationSize is 50, so maxCachedActivations should be 100
  assertEquals(config.wasmCache.maxCachedActivations, 100);
});

Deno.test("WasmCacheConfig - default compilationCacheSize matches static default", () => {
  const config = createNeatConfig({});
  assertEquals(
    config.wasmCache.compilationCacheSize,
    DEFAULT_WASM_CACHE_CONFIG.compilationCacheSize,
  );
});

Deno.test("WasmCacheConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    wasmCache: {
      maxCachedActivations: 256,
      compilationCacheSize: 50,
    },
  });
  assertEquals(config.wasmCache.maxCachedActivations, 256);
  assertEquals(config.wasmCache.compilationCacheSize, 50);
});

Deno.test("WasmCacheConfig - partial overrides merge with defaults", () => {
  const config = createNeatConfig({
    populationSize: 80,
    wasmCache: {
      compilationCacheSize: 200,
    },
  });
  // maxCachedActivations not set → defaults to populationSize * 2
  assertEquals(config.wasmCache.maxCachedActivations, 160);
  assertEquals(config.wasmCache.compilationCacheSize, 200);
});

Deno.test("WasmCacheConfig - string values coerced from CLI", () => {
  const config = createNeatConfig({
    wasmCache: {
      maxCachedActivations: "512" as unknown as number,
      compilationCacheSize: "75" as unknown as number,
    },
  });
  assertEquals(config.wasmCache.maxCachedActivations, 512);
  assertEquals(config.wasmCache.compilationCacheSize, 75);
});

Deno.test("WasmCacheConfig - maxCachedActivations must be >= 1", () => {
  assertThrows(
    () =>
      createNeatConfig({
        wasmCache: { maxCachedActivations: 0 },
      }),
    Error,
    "maxCachedActivations",
  );
});

Deno.test("WasmCacheConfig - compilationCacheSize must be >= 1", () => {
  assertThrows(
    () =>
      createNeatConfig({
        wasmCache: { compilationCacheSize: 0 },
      }),
    Error,
    "compilationCacheSize",
  );
});

Deno.test("WasmCacheConfig - maxCachedActivations must be integer", () => {
  assertThrows(
    () =>
      createNeatConfig({
        wasmCache: { maxCachedActivations: 2.5 },
      }),
    Error,
    "maxCachedActivations",
  );
});

Deno.test("WasmCacheConfig - compilationCacheSize must be integer", () => {
  assertThrows(
    () =>
      createNeatConfig({
        wasmCache: { compilationCacheSize: 3.7 },
      }),
    Error,
    "compilationCacheSize",
  );
});

Deno.test("WasmCacheConfig - negative values rejected", () => {
  assertThrows(
    () =>
      createNeatConfig({
        wasmCache: { maxCachedActivations: -1 },
      }),
    Error,
    "maxCachedActivations",
  );
});

Deno.test("WasmCacheConfig - large populationSize scales correctly", () => {
  const config = createNeatConfig({ populationSize: 500 });
  assertEquals(config.wasmCache.maxCachedActivations, 1000);
});

Deno.test("WasmCacheConfig - explicit activation cache overrides population scaling", () => {
  const config = createNeatConfig({
    populationSize: 500,
    wasmCache: { maxCachedActivations: 32 },
  });
  assertEquals(config.wasmCache.maxCachedActivations, 32);
});
