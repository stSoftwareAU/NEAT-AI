/**
 * Benchmark: BufferPool Performance
 *
 * Issue #1297 - Performance: Pre-allocated result buffers for batch operations
 *
 * This benchmark compares:
 * 1. Direct Float32Array allocation (new Float32Array)
 * 2. BufferPool acquire/release pattern
 *
 * The expected improvement is 5-10% reduction in allocation overhead
 * for batch operations running millions of times during evolution.
 *
 * Run with:
 *   deno bench --allow-read bench/BufferPoolPerformance.ts
 */

import { BufferPool } from "../src/utils/BufferPool.ts";

// Iterations per benchmark run - simulates hot loop workload
const ITERATIONS = 100_000;

// Test different buffer sizes
const SMALL_SIZE = 10;
const MEDIUM_SIZE = 100;
const LARGE_SIZE = 1000;

console.log(`BufferPool Benchmark: ${ITERATIONS} operations per iteration\n`);

// ============================================================================
// Test Case 1: Small Buffers (typical output size: 1-10)
// ============================================================================

Deno.bench(
  "Small (10): new Float32Array() [allocating]",
  { group: "small-buffers", baseline: true },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const buffer = new Float32Array(SMALL_SIZE);
      // Simulate usage
      buffer[0] = 1.0;
    }
  },
);

const smallPool = new BufferPool({ maxBuffersPerSize: 16 });
Deno.bench(
  "Small (10): BufferPool acquire/release [pooled]",
  { group: "small-buffers" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const buffer = smallPool.acquire(SMALL_SIZE);
      // Simulate usage
      buffer[0] = 1.0;
      smallPool.release(buffer);
    }
  },
);

// ============================================================================
// Test Case 2: Medium Buffers (typical input/output size: 50-200)
// ============================================================================

Deno.bench(
  "Medium (100): new Float32Array() [allocating]",
  { group: "medium-buffers", baseline: true },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const buffer = new Float32Array(MEDIUM_SIZE);
      // Simulate usage
      buffer[0] = 1.0;
      buffer[50] = 2.0;
    }
  },
);

const mediumPool = new BufferPool({ maxBuffersPerSize: 16 });
Deno.bench(
  "Medium (100): BufferPool acquire/release [pooled]",
  { group: "medium-buffers" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const buffer = mediumPool.acquire(MEDIUM_SIZE);
      // Simulate usage
      buffer[0] = 1.0;
      buffer[50] = 2.0;
      mediumPool.release(buffer);
    }
  },
);

// ============================================================================
// Test Case 3: Large Buffers (batch activations: 500-2000)
// ============================================================================

Deno.bench(
  "Large (1000): new Float32Array() [allocating]",
  { group: "large-buffers", baseline: true },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const buffer = new Float32Array(LARGE_SIZE);
      // Simulate usage
      buffer[0] = 1.0;
      buffer[500] = 2.0;
    }
  },
);

const largePool = new BufferPool({ maxBuffersPerSize: 16 });
Deno.bench(
  "Large (1000): BufferPool acquire/release [pooled]",
  { group: "large-buffers" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const buffer = largePool.acquire(LARGE_SIZE);
      // Simulate usage
      buffer[0] = 1.0;
      buffer[500] = 2.0;
      largePool.release(buffer);
    }
  },
);

// ============================================================================
// Test Case 4: Training Hot Loop Pattern (acquire input + output buffers)
// Simulates the pattern in Training.ts where both observations and targets
// are needed per record.
// ============================================================================

const INPUT_SIZE = 50;
const OUTPUT_SIZE = 5;

Deno.bench(
  "Training pattern: new Float32Array() [allocating]",
  { group: "training-pattern", baseline: true },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const observations = new Float32Array(INPUT_SIZE);
      const targets = new Float32Array(OUTPUT_SIZE);
      // Simulate usage
      observations[0] = 1.0;
      targets[0] = 0.5;
    }
  },
);

const trainingPool = new BufferPool({ maxBuffersPerSize: 4 });
// Pre-acquire the buffers once, then reuse
const obsBuffer = trainingPool.acquire(INPUT_SIZE);
const targetBuffer = trainingPool.acquire(OUTPUT_SIZE);

Deno.bench(
  "Training pattern: Pre-allocated [reused]",
  { group: "training-pattern" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      // In actual training, we copy into these buffers
      obsBuffer[0] = 1.0;
      targetBuffer[0] = 0.5;
      // No release - buffers are reused throughout the loop
    }
  },
);

// ============================================================================
// Test Case 5: Multiple Buffer Sizes (realistic batch scenario)
// During batch processing, different sized buffers may be needed.
// ============================================================================

Deno.bench(
  "Mixed sizes: new Float32Array() [allocating]",
  { group: "mixed-sizes", baseline: true },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const size = (i % 3 === 0) ? 10 : ((i % 3 === 1) ? 100 : 1000);
      const buffer = new Float32Array(size);
      buffer[0] = 1.0;
    }
  },
);

const mixedPool = new BufferPool({ maxBuffersPerSize: 8 });
Deno.bench(
  "Mixed sizes: BufferPool acquire/release [pooled]",
  { group: "mixed-sizes" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const size = (i % 3 === 0) ? 10 : ((i % 3 === 1) ? 100 : 1000);
      const buffer = mixedPool.acquire(size);
      buffer[0] = 1.0;
      mixedPool.release(buffer);
    }
  },
);

// ============================================================================
// Test Case 6: withBuffer scoped pattern
// ============================================================================

Deno.bench(
  "Scoped: new Float32Array() [allocating]",
  { group: "scoped-pattern", baseline: true },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const buffer = new Float32Array(MEDIUM_SIZE);
      buffer[0] = Math.random();
      // buffer goes out of scope, GC handles it
    }
  },
);

const scopedPool = new BufferPool({ maxBuffersPerSize: 16 });
Deno.bench(
  "Scoped: BufferPool.withBuffer() [pooled]",
  { group: "scoped-pattern" },
  () => {
    for (let i = 0; i < ITERATIONS; i++) {
      scopedPool.withBuffer(MEDIUM_SIZE, (buffer) => {
        buffer[0] = Math.random();
      });
    }
  },
);

console.log(`\n`);
