import {
  assertAlmostEquals,
  assertEquals,
  assertGreaterOrEqual,
} from "@std/assert";
import {
  BackpropBuffers,
  type BackpropBufferSet,
} from "../../src/propagate/BackpropBuffers.ts";

Deno.test("BackpropBuffers - acquire returns buffer with sufficient capacity", () => {
  const pool = new BackpropBuffers(10);
  const buf = pool.acquire(5);

  assertGreaterOrEqual(buf.capacity, 5);
  assertGreaterOrEqual(buf.fromActivationCache.length, 5);
  assertGreaterOrEqual(buf.fromWeightCache.length, 5);
  assertGreaterOrEqual(buf.fromValueCache.length, 5);
  assertGreaterOrEqual(buf.safeZoneFactorCache.length, 5);
  assertGreaterOrEqual(buf.fusedSquashTypes.length, 5);
  assertGreaterOrEqual(buf.fusedHintValues.length, 5);
  assertGreaterOrEqual(buf.fusedActivations.length, 5);
  assertGreaterOrEqual(buf.fusedWeights.length, 5);

  pool.release(buf);
});

Deno.test("BackpropBuffers - released buffer is reused by next acquire", () => {
  const pool = new BackpropBuffers(10);
  const buf1 = pool.acquire(5);

  // Write a marker value
  buf1.fromActivationCache[0] = 42;
  pool.release(buf1);

  const buf2 = pool.acquire(5);

  // Should be the same object (reused from pool)
  assertEquals(buf2.fromActivationCache[0], 42);

  pool.release(buf2);
});

Deno.test("BackpropBuffers - acquire without release gives distinct buffers", () => {
  const pool = new BackpropBuffers(10);
  const buf1 = pool.acquire(5);
  const buf2 = pool.acquire(5);

  // Different objects (stack-based: buf1 still in use)
  buf1.fromActivationCache[0] = 1;
  buf2.fromActivationCache[0] = 2;
  assertEquals(buf1.fromActivationCache[0], 1);
  assertEquals(buf2.fromActivationCache[0], 2);

  pool.release(buf2);
  pool.release(buf1);
});

Deno.test("BackpropBuffers - grows capacity when larger buffer needed", () => {
  const pool = new BackpropBuffers(5);
  const buf = pool.acquire(5);
  pool.release(buf);

  // Now request a larger buffer — should grow the pooled one
  const buf2 = pool.acquire(20);
  assertGreaterOrEqual(buf2.capacity, 20);
  assertGreaterOrEqual(buf2.fromActivationCache.length, 20);
  assertGreaterOrEqual(buf2.fusedSquashTypes.length, 20);

  pool.release(buf2);
});

Deno.test("BackpropBuffers - zero initial capacity works", () => {
  const pool = new BackpropBuffers();
  const buf = pool.acquire(3);

  assertGreaterOrEqual(buf.capacity, 3);
  assertGreaterOrEqual(buf.fromActivationCache.length, 3);

  pool.release(buf);
});

Deno.test("BackpropBuffers - stack semantics for recursive use", () => {
  const pool = new BackpropBuffers(10);

  // Simulate recursive propagation: acquire 3 levels deep, release in reverse
  const buffers: BackpropBufferSet[] = [];
  for (let depth = 0; depth < 3; depth++) {
    const buf = pool.acquire(5);
    buf.fromActivationCache[0] = depth;
    buffers.push(buf);
  }

  // Each has its own data
  for (let depth = 0; depth < 3; depth++) {
    assertEquals(buffers[depth].fromActivationCache[0], depth);
  }

  // Release in reverse order (LIFO, like function returns)
  for (let depth = 2; depth >= 0; depth--) {
    pool.release(buffers[depth]);
  }

  // Re-acquire should reuse pooled buffers
  const reacquired = pool.acquire(5);
  assertGreaterOrEqual(reacquired.capacity, 5);
  pool.release(reacquired);
});

Deno.test("BackpropBuffers - typed array subarray works for WASM views", () => {
  const pool = new BackpropBuffers(20);
  const buf = pool.acquire(10);

  // Write data to first 5 elements
  for (let i = 0; i < 5; i++) {
    buf.fusedSquashTypes[i] = i + 1;
    buf.fusedActivations[i] = (i + 1) * 0.1;
  }

  // subarray creates a view of the correct length
  const squashView = buf.fusedSquashTypes.subarray(0, 5);
  const activationView = buf.fusedActivations.subarray(0, 5);

  assertEquals(squashView.length, 5);
  assertEquals(activationView.length, 5);
  assertEquals(squashView[0], 1);
  assertEquals(squashView[4], 5);
  assertAlmostEquals(activationView[0], 0.1, 1e-6);

  pool.release(buf);
});
