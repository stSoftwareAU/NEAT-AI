/**
 * Benchmark for fitness evaluation queue dequeue performance (Issue #1481).
 *
 * Compares Array.shift() (O(n) per dequeue, O(n²) total) vs index-pointer
 * approach (O(1) per dequeue, O(n) total) for the work-stealing queue in
 * Fitness.calculate().
 *
 * Run with:
 *   deno bench bench/FitnessQueueDequeue.ts
 */

/**
 * Simulates the old approach: using Array.shift() to dequeue items.
 * Each shift() is O(n) because it re-indexes all remaining elements.
 */
function dequeueWithShift(size: number): number {
  const queue: number[] = [];
  for (let i = 0; i < size; i++) {
    queue.push(i);
  }

  let sum = 0;
  while (queue.length > 0) {
    const item = queue.shift()!;
    sum += item;
  }
  return sum;
}

/**
 * Simulates the new approach: using an index pointer to dequeue items.
 * Each dequeue is O(1) — just increment the pointer.
 */
function dequeueWithIndexPointer(size: number): number {
  const queue: number[] = [];
  for (let i = 0; i < size; i++) {
    queue.push(i);
  }

  let sum = 0;
  let front = 0;
  while (front < queue.length) {
    const item = queue[front++];
    sum += item;
  }
  return sum;
}

// ============================================
// Small population (100 items)
// ============================================

Deno.bench({
  name: "Array.shift() — 100 items",
  group: "100 items",
  baseline: true,
  fn() {
    dequeueWithShift(100);
  },
});

Deno.bench({
  name: "Index pointer — 100 items",
  group: "100 items",
  fn() {
    dequeueWithIndexPointer(100);
  },
});

// ============================================
// Medium population (1,000 items)
// ============================================

Deno.bench({
  name: "Array.shift() — 1,000 items",
  group: "1,000 items",
  baseline: true,
  fn() {
    dequeueWithShift(1_000);
  },
});

Deno.bench({
  name: "Index pointer — 1,000 items",
  group: "1,000 items",
  fn() {
    dequeueWithIndexPointer(1_000);
  },
});

// ============================================
// Large population (10,000 items)
// ============================================

Deno.bench({
  name: "Array.shift() — 10,000 items",
  group: "10,000 items",
  baseline: true,
  fn() {
    dequeueWithShift(10_000);
  },
});

Deno.bench({
  name: "Index pointer — 10,000 items",
  group: "10,000 items",
  fn() {
    dequeueWithIndexPointer(10_000);
  },
});

// ============================================
// Very large population (100,000 items)
// ============================================

Deno.bench({
  name: "Array.shift() — 100,000 items",
  group: "100,000 items",
  baseline: true,
  fn() {
    dequeueWithShift(100_000);
  },
});

Deno.bench({
  name: "Index pointer — 100,000 items",
  group: "100,000 items",
  fn() {
    dequeueWithIndexPointer(100_000);
  },
});
