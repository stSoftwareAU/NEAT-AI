import { assertEquals } from "@std/assert";
import { CompactSynapseStore } from "../../src/architecture/CompactSynapseStore.ts";

Deno.test("CompactSynapseStore: fromArrays creates correct store", () => {
  const store = CompactSynapseStore.fromArrays(
    [0, 0, 1, 2],
    [1, 2, 3, 3],
    [0.1, 0.2, 0.3, 0.4],
  );

  assertEquals(store.count, 4);
  assertEquals(store.getFrom(0), 0);
  assertEquals(store.getTo(0), 1);
  assertEquals(store.getWeight(0), 0.1);
  assertEquals(store.getFrom(3), 2);
  assertEquals(store.getTo(3), 3);
  assertEquals(store.getWeight(3), 0.4);
});

Deno.test("CompactSynapseStore: setWeight modifies weight", () => {
  const store = CompactSynapseStore.fromArrays(
    [0, 1],
    [1, 2],
    [0.5, 0.6],
  );

  store.setWeight(0, 0.99);
  assertEquals(store.getWeight(0), 0.99);
  assertEquals(store.getWeight(1), 0.6); // unaffected
});

Deno.test("CompactSynapseStore: binarySearchFrom finds first match", () => {
  const store = CompactSynapseStore.fromArrays(
    [0, 0, 1, 1, 2, 3],
    [1, 2, 2, 3, 3, 4],
    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  );

  // Should find the first entry with from=1
  const idx = store.binarySearchFrom(1);
  assertEquals(idx, 2);
  assertEquals(store.getFrom(idx), 1);

  // from=0 should return 0
  assertEquals(store.binarySearchFrom(0), 0);

  // from=3 should return 5
  assertEquals(store.binarySearchFrom(3), 5);

  // from=99 should return -1
  assertEquals(store.binarySearchFrom(99), -1);
});

Deno.test("CompactSynapseStore: binarySearchFromTo finds exact pair", () => {
  const store = CompactSynapseStore.fromArrays(
    [0, 0, 1, 1, 2],
    [1, 3, 2, 4, 3],
    [0.1, 0.2, 0.3, 0.4, 0.5],
  );

  assertEquals(store.binarySearchFromTo(1, 4), 3);
  assertEquals(store.binarySearchFromTo(0, 1), 0);
  assertEquals(store.binarySearchFromTo(2, 3), 4);
  assertEquals(store.binarySearchFromTo(0, 2), -1); // doesn't exist
  assertEquals(store.binarySearchFromTo(5, 5), -1); // doesn't exist
});

Deno.test("CompactSynapseStore: findByTo collects matching indices", () => {
  const store = CompactSynapseStore.fromArrays(
    [0, 1, 2, 3],
    [3, 3, 3, 4],
    [0.1, 0.2, 0.3, 0.4],
  );

  const results = store.findByTo(3);
  assertEquals(results, [0, 1, 2]);

  const results4 = store.findByTo(4);
  assertEquals(results4, [3]);

  const resultsNone = store.findByTo(99);
  assertEquals(resultsNone, []);
});

Deno.test("CompactSynapseStore: findByFrom collects matching indices", () => {
  const store = CompactSynapseStore.fromArrays(
    [0, 0, 0, 1, 2],
    [1, 2, 3, 3, 4],
    [0.1, 0.2, 0.3, 0.4, 0.5],
  );

  const results = store.findByFrom(0);
  assertEquals(results, [0, 1, 2]);

  const results1 = store.findByFrom(1);
  assertEquals(results1, [3]);

  const resultsNone = store.findByFrom(99);
  assertEquals(resultsNone, []);
});

Deno.test("CompactSynapseStore: sumWeights returns correct total", () => {
  const store = CompactSynapseStore.fromArrays(
    [0, 1, 2],
    [1, 2, 3],
    [0.1, 0.2, 0.3],
  );

  const sum = store.sumWeights();
  const expected = 0.1 + 0.2 + 0.3;
  // Use approximate comparison due to floating point
  assertEquals(Math.abs(sum - expected) < 1e-10, true);
});

Deno.test("CompactSynapseStore: empty store operations", () => {
  const store = new CompactSynapseStore(10);
  assertEquals(store.count, 0);
  assertEquals(store.sumWeights(), 0);
  assertEquals(store.binarySearchFrom(0), -1);
  assertEquals(store.binarySearchFromTo(0, 1), -1);
  assertEquals(store.findByTo(0), []);
  assertEquals(store.findByFrom(0), []);
});
