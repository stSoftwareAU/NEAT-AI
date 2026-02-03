/**
 * BufferPool tests - Pre-allocated result buffers for batch operations.
 *
 * Issue #1297: Performance optimisation to reduce allocation overhead in hot loops
 * by reusing TypedArrays instead of allocating new ones on each call.
 *
 * These tests verify:
 * - Buffer acquisition and release behaviour
 * - Buffer reuse after release
 * - Size-based buffer pooling
 * - Pool clearing functionality
 * - Thread safety considerations (single-threaded use)
 */
import {
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
} from "@std/assert";
import { BufferPool } from "../src/utils/BufferPool.ts";

/**
 * Test that a newly created pool starts empty.
 */
Deno.test("BufferPool: starts empty with zero buffers", () => {
  const pool = new BufferPool();
  assertEquals(pool.availableCount, 0, "Pool should start with no buffers");
});

/**
 * Test that acquire returns a buffer of the requested size.
 */
Deno.test("BufferPool: acquire returns buffer of correct size", () => {
  const pool = new BufferPool();
  const buffer = pool.acquire(10);
  assertEquals(buffer.length, 10, "Buffer should have requested size");
});

/**
 * Test that released buffers can be reused.
 */
Deno.test("BufferPool: release allows buffer reuse", () => {
  const pool = new BufferPool();

  // Acquire and release a buffer
  const buffer1 = pool.acquire(10);
  pool.release(buffer1);

  assertEquals(pool.availableCount, 1, "Pool should have one available buffer");

  // Acquire again - should get the same buffer
  const buffer2 = pool.acquire(10);
  assertStrictEquals(
    buffer1,
    buffer2,
    "Should reuse the same buffer instance",
  );
  assertEquals(pool.availableCount, 0, "Pool should be empty after acquire");
});

/**
 * Test that buffers of different sizes are tracked separately.
 */
Deno.test("BufferPool: different sizes tracked separately", () => {
  const pool = new BufferPool();

  // Acquire buffers of different sizes
  const small = pool.acquire(10);
  const large = pool.acquire(100);

  // Release both
  pool.release(small);
  pool.release(large);

  assertEquals(pool.availableCount, 2, "Pool should have two buffers");

  // Acquire a small buffer - should get the small one back
  const reacquiredSmall = pool.acquire(10);
  assertStrictEquals(
    small,
    reacquiredSmall,
    "Should reuse matching size buffer",
  );

  // Acquire a large buffer - should get the large one back
  const reacquiredLarge = pool.acquire(100);
  assertStrictEquals(
    large,
    reacquiredLarge,
    "Should reuse matching size buffer",
  );
});

/**
 * Test that acquired buffers are zeroed.
 */
Deno.test("BufferPool: acquired buffers are zeroed", () => {
  const pool = new BufferPool();

  // Acquire a buffer and write data to it
  const buffer = pool.acquire(5);
  buffer[0] = 1;
  buffer[1] = 2;
  buffer[2] = 3;
  buffer[3] = 4;
  buffer[4] = 5;

  // Release and reacquire
  pool.release(buffer);
  const reacquired = pool.acquire(5);

  // Buffer should be zeroed
  for (let i = 0; i < 5; i++) {
    assertEquals(reacquired[i], 0, `Buffer[${i}] should be zeroed`);
  }
});

/**
 * Test that clear removes all pooled buffers.
 */
Deno.test("BufferPool: clear removes all buffers", () => {
  const pool = new BufferPool();

  // Add several buffers
  const buf1 = pool.acquire(10);
  const buf2 = pool.acquire(20);
  const buf3 = pool.acquire(30);

  pool.release(buf1);
  pool.release(buf2);
  pool.release(buf3);

  assertEquals(pool.availableCount, 3, "Pool should have 3 buffers");

  pool.clear();
  assertEquals(pool.availableCount, 0, "Pool should be empty after clear");

  // New acquire should return a different buffer
  const newBuf = pool.acquire(10);
  assertNotStrictEquals(buf1, newBuf, "Should be a new buffer after clear");
});

/**
 * Test that when no matching size is available, a new buffer is created.
 */
Deno.test("BufferPool: creates new buffer when no match available", () => {
  const pool = new BufferPool();

  // Release a buffer of size 10
  const buf10 = pool.acquire(10);
  pool.release(buf10);

  // Acquire a buffer of size 20 - should create new, not reuse
  const buf20 = pool.acquire(20);
  assertEquals(buf20.length, 20, "Should create buffer of requested size");
  assertNotStrictEquals(
    buf10,
    buf20,
    "Should not reuse different sized buffer",
  );
});

/**
 * Test multiple buffers of the same size can be pooled.
 */
Deno.test("BufferPool: multiple buffers of same size", () => {
  const pool = new BufferPool();

  // Acquire multiple buffers of same size
  const buf1 = pool.acquire(10);
  const buf2 = pool.acquire(10);
  const buf3 = pool.acquire(10);

  // Release all
  pool.release(buf1);
  pool.release(buf2);
  pool.release(buf3);

  assertEquals(pool.availableCount, 3, "Pool should have 3 buffers");

  // Acquire all back
  const reacquired1 = pool.acquire(10);
  const reacquired2 = pool.acquire(10);
  const reacquired3 = pool.acquire(10);

  assertEquals(pool.availableCount, 0, "Pool should be empty");

  // Should have received the original buffers (though order may vary)
  const originals = new Set([buf1, buf2, buf3]);
  assertEquals(originals.has(reacquired1), true, "Should be original buffer");
  assertEquals(originals.has(reacquired2), true, "Should be original buffer");
  assertEquals(originals.has(reacquired3), true, "Should be original buffer");
});

/**
 * Test acquireMany returns array of buffers.
 */
Deno.test("BufferPool: acquireMany returns correct number of buffers", () => {
  const pool = new BufferPool();

  const buffers = pool.acquireMany(10, 5);
  assertEquals(buffers.length, 5, "Should return requested count");

  for (const buf of buffers) {
    assertEquals(buf.length, 10, "Each buffer should have correct size");
  }
});

/**
 * Test releaseMany releases all buffers.
 */
Deno.test("BufferPool: releaseMany releases all buffers", () => {
  const pool = new BufferPool();

  const buffers = pool.acquireMany(10, 3);
  assertEquals(pool.availableCount, 0, "Pool should be empty");

  pool.releaseMany(buffers);
  assertEquals(pool.availableCount, 3, "Pool should have 3 buffers");
});

/**
 * Test that the pool respects maximum capacity.
 */
Deno.test("BufferPool: respects maximum capacity", () => {
  const pool = new BufferPool({ maxBuffersPerSize: 2 });

  // Acquire and release 3 buffers of same size
  const buf1 = pool.acquire(10);
  const buf2 = pool.acquire(10);
  const buf3 = pool.acquire(10);

  pool.release(buf1);
  pool.release(buf2);
  pool.release(buf3); // This one should be dropped

  assertEquals(pool.availableCount, 2, "Pool should only keep 2 buffers");
});

/**
 * Test scoped buffer usage with callback pattern.
 */
Deno.test("BufferPool: withBuffer provides scoped access", () => {
  const pool = new BufferPool();

  let capturedBuffer: Float32Array | null = null;

  pool.withBuffer(10, (buffer) => {
    capturedBuffer = buffer;
    assertEquals(buffer.length, 10, "Buffer should have correct size");
    buffer[0] = 42;
  });

  // After callback, buffer should be released back to pool
  assertEquals(pool.availableCount, 1, "Buffer should be released");

  // If we acquire again, we should get the same buffer (zeroed)
  const reacquired = pool.acquire(10);
  assertStrictEquals(capturedBuffer, reacquired, "Should reuse buffer");
  assertEquals(reacquired[0], 0, "Buffer should be zeroed");
});

/**
 * Test that acquireExact only reuses buffers of exact matching size.
 */
Deno.test("BufferPool: acquireExact only matches exact size", () => {
  const pool = new BufferPool();

  // Release buffer of size 10
  const buf10 = pool.acquire(10);
  pool.release(buf10);

  // acquireExact for size 10 should succeed
  const exact10 = pool.acquireExact(10);
  assertStrictEquals(buf10, exact10, "Should return exact match");
});

/**
 * Test statistics reporting.
 */
Deno.test("BufferPool: statistics tracking", () => {
  const pool = new BufferPool();

  // Initial stats
  let stats = pool.getStatistics();
  assertEquals(stats.totalAcquired, 0, "No acquisitions yet");
  assertEquals(stats.totalReleased, 0, "No releases yet");
  assertEquals(stats.cacheHits, 0, "No cache hits yet");
  assertEquals(stats.cacheMisses, 0, "No cache misses yet");

  // Acquire (cache miss)
  const buf = pool.acquire(10);
  stats = pool.getStatistics();
  assertEquals(stats.totalAcquired, 1, "One acquisition");
  assertEquals(stats.cacheMisses, 1, "One cache miss");

  // Release
  pool.release(buf);
  stats = pool.getStatistics();
  assertEquals(stats.totalReleased, 1, "One release");

  // Acquire again (cache hit)
  pool.acquire(10);
  stats = pool.getStatistics();
  assertEquals(stats.totalAcquired, 2, "Two acquisitions");
  assertEquals(stats.cacheHits, 1, "One cache hit");
});

/**
 * Test global/shared pool instance.
 */
Deno.test("BufferPool: global instance accessible", () => {
  const globalPool = BufferPool.global;
  assertEquals(
    globalPool instanceof BufferPool,
    true,
    "Should be a BufferPool",
  );

  // Should be the same instance each time
  assertStrictEquals(
    globalPool,
    BufferPool.global,
    "Should return same instance",
  );
});
