/**
 * Benchmark for ParallelBreeding queue dequeue performance.
 *
 * Issue #2279: Compares Array.shift() vs index pointer for the
 * work-stealing queue in ParallelBreeding.breedWithWorkers().
 *
 * This extends FitnessQueueDequeue.ts with breeding-specific queue
 * sizes (typical breeding batch counts) and simulated worker contention.
 *
 * Run with:
 *   deno bench bench/BreedingQueueDequeue.ts
 */

interface MockParentPair {
  motherIdx: number;
  fatherIdx: number;
}

/**
 * Simulates the old approach: Array.shift() for each dequeue.
 * O(n) per removal, O(n²) total for draining the queue.
 */
function breedQueueWithShift(count: number): number {
  const queue: MockParentPair[] = [];
  for (let i = 0; i < count; i++) {
    queue.push({ motherIdx: i, fatherIdx: i + 1 });
  }

  let processed = 0;
  while (queue.length > 0) {
    const pair = queue.shift();
    if (!pair) break;
    processed += pair.motherIdx;
  }
  return processed;
}

/**
 * Simulates the new approach: index pointer for O(1) dequeue.
 * O(1) per removal, O(n) total for draining the queue.
 */
function breedQueueWithIndexPointer(count: number): number {
  const queue: MockParentPair[] = [];
  for (let i = 0; i < count; i++) {
    queue.push({ motherIdx: i, fatherIdx: i + 1 });
  }

  let processed = 0;
  let front = 0;
  while (front < queue.length) {
    const pair = queue[front++];
    if (!pair) break;
    processed += pair.motherIdx;
  }
  return processed;
}

// ============================================
// Small breeding batch (50 offspring — typical)
// ============================================

Deno.bench({
  name: "Array.shift() — 50 breeding pairs",
  group: "50 pairs",
  baseline: true,
  fn() {
    breedQueueWithShift(50);
  },
});

Deno.bench({
  name: "Index pointer — 50 breeding pairs",
  group: "50 pairs",
  fn() {
    breedQueueWithIndexPointer(50);
  },
});

// ============================================
// Medium breeding batch (200 offspring)
// ============================================

Deno.bench({
  name: "Array.shift() — 200 breeding pairs",
  group: "200 pairs",
  baseline: true,
  fn() {
    breedQueueWithShift(200);
  },
});

Deno.bench({
  name: "Index pointer — 200 breeding pairs",
  group: "200 pairs",
  fn() {
    breedQueueWithIndexPointer(200);
  },
});

// ============================================
// Large breeding batch (500 offspring)
// ============================================

Deno.bench({
  name: "Array.shift() — 500 breeding pairs",
  group: "500 pairs",
  baseline: true,
  fn() {
    breedQueueWithShift(500);
  },
});

Deno.bench({
  name: "Index pointer — 500 breeding pairs",
  group: "500 pairs",
  fn() {
    breedQueueWithIndexPointer(500);
  },
});
