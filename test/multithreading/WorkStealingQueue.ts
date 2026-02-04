/**
 * Issue #1290 - Work-stealing queue for worker load balancing
 *
 * Tests for the WorkStealingQueue class that implements a concurrent
 * deque (double-ended queue) pattern for better load distribution
 * across workers.
 */
import { assertEquals, assertExists, assertGreater } from "@std/assert";
import { WorkStealingQueue } from "../../src/multithreading/WorkStealingQueue.ts";

// Test task interface for testing
interface TestTask {
  id: number;
  estimatedDuration?: number;
}

Deno.test("WorkStealingQueue - pushBack adds task to end of queue", () => {
  const queue = new WorkStealingQueue<TestTask>();
  const task: TestTask = { id: 1 };

  queue.pushBack(task);

  assertEquals(queue.size(), 1);
  assertEquals(queue.isEmpty(), false);
});

Deno.test("WorkStealingQueue - popFront removes task from front of queue", () => {
  const queue = new WorkStealingQueue<TestTask>();
  const task1: TestTask = { id: 1 };
  const task2: TestTask = { id: 2 };

  queue.pushBack(task1);
  queue.pushBack(task2);

  const popped = queue.popFront();
  assertEquals(popped?.id, 1);
  assertEquals(queue.size(), 1);
});

Deno.test("WorkStealingQueue - popBack removes task from back of queue (for stealing)", () => {
  const queue = new WorkStealingQueue<TestTask>();
  const task1: TestTask = { id: 1 };
  const task2: TestTask = { id: 2 };
  const task3: TestTask = { id: 3 };

  queue.pushBack(task1);
  queue.pushBack(task2);
  queue.pushBack(task3);

  const stolen = queue.popBack();
  assertEquals(stolen?.id, 3);
  assertEquals(queue.size(), 2);
});

Deno.test("WorkStealingQueue - popFront returns undefined for empty queue", () => {
  const queue = new WorkStealingQueue<TestTask>();

  const popped = queue.popFront();
  assertEquals(popped, undefined);
});

Deno.test("WorkStealingQueue - popBack returns undefined for empty queue", () => {
  const queue = new WorkStealingQueue<TestTask>();

  const stolen = queue.popBack();
  assertEquals(stolen, undefined);
});

Deno.test("WorkStealingQueue - isEmpty returns true for empty queue", () => {
  const queue = new WorkStealingQueue<TestTask>();

  assertEquals(queue.isEmpty(), true);
});

Deno.test("WorkStealingQueue - size returns correct count", () => {
  const queue = new WorkStealingQueue<TestTask>();

  assertEquals(queue.size(), 0);

  queue.pushBack({ id: 1 });
  assertEquals(queue.size(), 1);

  queue.pushBack({ id: 2 });
  assertEquals(queue.size(), 2);

  queue.popFront();
  assertEquals(queue.size(), 1);

  queue.popBack();
  assertEquals(queue.size(), 0);
});

Deno.test("WorkStealingQueue - FIFO ordering for owner operations", () => {
  const queue = new WorkStealingQueue<TestTask>();

  queue.pushBack({ id: 1 });
  queue.pushBack({ id: 2 });
  queue.pushBack({ id: 3 });

  assertEquals(queue.popFront()?.id, 1);
  assertEquals(queue.popFront()?.id, 2);
  assertEquals(queue.popFront()?.id, 3);
  assertEquals(queue.popFront(), undefined);
});

Deno.test("WorkStealingQueue - steal operation takes from opposite end", () => {
  const queue = new WorkStealingQueue<TestTask>();

  // Owner adds tasks
  queue.pushBack({ id: 1 });
  queue.pushBack({ id: 2 });
  queue.pushBack({ id: 3 });

  // Thief steals from back
  assertEquals(queue.popBack()?.id, 3);

  // Owner takes from front
  assertEquals(queue.popFront()?.id, 1);

  // Both meet in the middle
  assertEquals(queue.popFront()?.id, 2);
  assertEquals(queue.popBack(), undefined);
});

Deno.test("WorkStealingQueue - clear empties the queue", () => {
  const queue = new WorkStealingQueue<TestTask>();

  queue.pushBack({ id: 1 });
  queue.pushBack({ id: 2 });
  queue.pushBack({ id: 3 });

  assertEquals(queue.size(), 3);

  queue.clear();

  assertEquals(queue.size(), 0);
  assertEquals(queue.isEmpty(), true);
  assertEquals(queue.popFront(), undefined);
});

Deno.test("WorkStealingQueue - peek returns front task without removing", () => {
  const queue = new WorkStealingQueue<TestTask>();

  queue.pushBack({ id: 1 });
  queue.pushBack({ id: 2 });

  const peeked = queue.peek();
  assertEquals(peeked?.id, 1);
  assertEquals(queue.size(), 2); // Size unchanged
});

Deno.test("WorkStealingQueue - peekBack returns back task without removing", () => {
  const queue = new WorkStealingQueue<TestTask>();

  queue.pushBack({ id: 1 });
  queue.pushBack({ id: 2 });
  queue.pushBack({ id: 3 });

  const peeked = queue.peekBack();
  assertEquals(peeked?.id, 3);
  assertEquals(queue.size(), 3); // Size unchanged
});

Deno.test("WorkStealingQueue - getEstimatedWorkload returns sum of estimated durations", () => {
  const queue = new WorkStealingQueue<TestTask>();

  queue.pushBack({ id: 1, estimatedDuration: 100 });
  queue.pushBack({ id: 2, estimatedDuration: 200 });
  queue.pushBack({ id: 3, estimatedDuration: 150 });

  const workload = queue.getEstimatedWorkload(
    (task: TestTask) => task.estimatedDuration ?? 0,
  );
  assertEquals(workload, 450);
});

Deno.test("WorkStealingQueue - getEstimatedWorkload returns 0 for empty queue", () => {
  const queue = new WorkStealingQueue<TestTask>();

  const workload = queue.getEstimatedWorkload(
    (task: TestTask) => task.estimatedDuration ?? 0,
  );
  assertEquals(workload, 0);
});

Deno.test("WorkStealingQueue - handles rapid push and pop operations", () => {
  const queue = new WorkStealingQueue<TestTask>();

  // Simulate rapid task additions and removals
  for (let i = 0; i < 100; i++) {
    queue.pushBack({ id: i });
    if (i % 2 === 0) {
      const popped = queue.popFront();
      assertExists(popped);
    }
  }

  // Should have roughly half the tasks remaining
  assertGreater(queue.size(), 0);
});

Deno.test("WorkStealingQueue - maintains order with interleaved operations", () => {
  const queue = new WorkStealingQueue<TestTask>();

  queue.pushBack({ id: 1 });
  queue.pushBack({ id: 2 });
  assertEquals(queue.popFront()?.id, 1);

  queue.pushBack({ id: 3 });
  queue.pushBack({ id: 4 });
  assertEquals(queue.popBack()?.id, 4);
  assertEquals(queue.popFront()?.id, 2);
  assertEquals(queue.popFront()?.id, 3);

  assertEquals(queue.isEmpty(), true);
});

Deno.test("WorkStealingQueue - toArray returns tasks in order", () => {
  const queue = new WorkStealingQueue<TestTask>();

  queue.pushBack({ id: 1 });
  queue.pushBack({ id: 2 });
  queue.pushBack({ id: 3 });

  const array = queue.toArray();
  assertEquals(array.length, 3);
  assertEquals(array[0].id, 1);
  assertEquals(array[1].id, 2);
  assertEquals(array[2].id, 3);

  // Original queue unchanged
  assertEquals(queue.size(), 3);
});

Deno.test("WorkStealingQueue - stealHalf takes half the tasks", () => {
  const queue = new WorkStealingQueue<TestTask>();

  queue.pushBack({ id: 1 });
  queue.pushBack({ id: 2 });
  queue.pushBack({ id: 3 });
  queue.pushBack({ id: 4 });

  const stolen = queue.stealHalf();

  assertEquals(stolen.length, 2);
  assertEquals(queue.size(), 2);

  // Stolen from the back
  assertEquals(stolen[0].id, 3);
  assertEquals(stolen[1].id, 4);

  // Front remains
  assertEquals(queue.popFront()?.id, 1);
  assertEquals(queue.popFront()?.id, 2);
});

Deno.test("WorkStealingQueue - stealHalf with odd number rounds down", () => {
  const queue = new WorkStealingQueue<TestTask>();

  queue.pushBack({ id: 1 });
  queue.pushBack({ id: 2 });
  queue.pushBack({ id: 3 });
  queue.pushBack({ id: 4 });
  queue.pushBack({ id: 5 });

  const stolen = queue.stealHalf();

  assertEquals(stolen.length, 2); // floor(5/2) = 2
  assertEquals(queue.size(), 3);
});

Deno.test("WorkStealingQueue - stealHalf from empty queue returns empty array", () => {
  const queue = new WorkStealingQueue<TestTask>();

  const stolen = queue.stealHalf();

  assertEquals(stolen.length, 0);
});

Deno.test("WorkStealingQueue - stealHalf from single item queue returns empty array", () => {
  const queue = new WorkStealingQueue<TestTask>();

  queue.pushBack({ id: 1 });

  const stolen = queue.stealHalf();

  assertEquals(stolen.length, 0);
  assertEquals(queue.size(), 1);
});
