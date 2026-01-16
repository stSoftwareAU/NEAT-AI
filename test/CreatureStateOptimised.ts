import { assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import { CreatureState } from "../src/architecture/CreatureState.ts";
import { DenseNumberMap } from "../src/architecture/DenseNumberMap.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Tests for TypedArray-based dense neuron state storage optimisation.
 * Issue #1041: Use TypedArray for dense neuron state storage.
 *
 * These tests verify that the optimised CreatureState implementation
 * provides the same behaviour as the original while using more
 * memory-efficient TypedArray storage for dense data.
 */

Deno.test("DenseNumberMap basic operations", () => {
  const map = new DenseNumberMap(10);

  // Initially all values should not exist
  assertEquals(map.has(0), false);
  assertEquals(map.has(5), false);
  assertEquals(map.has(9), false);

  // Set some values
  map.set(0, 0.5);
  map.set(5, 1.25);
  map.set(9, -0.75);

  // Verify has() returns true for set values
  assertEquals(map.has(0), true);
  assertEquals(map.has(5), true);
  assertEquals(map.has(9), true);
  assertEquals(map.has(1), false);
  assertEquals(map.has(8), false);

  // Verify get() returns correct values
  assertAlmostEquals(map.get(0) as number, 0.5, 0.000001);
  assertAlmostEquals(map.get(5) as number, 1.25, 0.000001);
  assertAlmostEquals(map.get(9) as number, -0.75, 0.000001);

  // Verify get() returns undefined for unset values
  assertEquals(map.get(1), undefined);
  assertEquals(map.get(8), undefined);
});

Deno.test("DenseNumberMap clear operation", () => {
  const map = new DenseNumberMap(10);

  // Set some values
  map.set(0, 0.5);
  map.set(5, 1.25);
  map.set(9, -0.75);

  // Verify values are set
  assertEquals(map.has(0), true);
  assertEquals(map.has(5), true);
  assertEquals(map.has(9), true);

  // Clear all values
  map.clear();

  // Verify all values are cleared
  assertEquals(map.has(0), false);
  assertEquals(map.has(5), false);
  assertEquals(map.has(9), false);
});

Deno.test("DenseNumberMap overwrite values", () => {
  const map = new DenseNumberMap(10);

  // Set initial value
  map.set(3, 1.0);
  assertAlmostEquals(map.get(3) as number, 1.0, 0.000001);

  // Overwrite with new value
  map.set(3, 2.5);
  assertAlmostEquals(map.get(3) as number, 2.5, 0.000001);

  // Overwrite with negative value
  map.set(3, -0.123);
  assertAlmostEquals(map.get(3) as number, -0.123, 0.000001);
});

Deno.test("DenseNumberMap handles zero values correctly", () => {
  const map = new DenseNumberMap(10);

  // Set a zero value
  map.set(2, 0);

  // Zero is a valid value, so has() should return true
  assertEquals(map.has(2), true);
  assertAlmostEquals(map.get(2) as number, 0, 0.000001);

  // Clear and verify
  map.clear();
  assertEquals(map.has(2), false);
});

Deno.test("DenseNumberMap resize when needed", () => {
  const map = new DenseNumberMap(5);

  // Set value within initial size
  map.set(3, 1.0);
  assertEquals(map.has(3), true);

  // Set value beyond initial size - should auto-resize
  map.set(10, 2.0);
  assertEquals(map.has(10), true);
  assertAlmostEquals(map.get(10) as number, 2.0, 0.000001);

  // Original values should still be preserved
  assertEquals(map.has(3), true);
  assertAlmostEquals(map.get(3) as number, 1.0, 0.000001);
});

Deno.test("CreatureState cacheAdjustedActivation uses DenseNumberMap", () => {
  const creature = Creature.fromJSON({
    "neurons": [{
      "bias": 0,
      "type": "hidden",
      "squash": "LOGISTIC",
      "index": 2,
    }, {
      "bias": 0,
      "type": "hidden",
      "squash": "LOGISTIC",
      "index": 3,
    }, {
      "bias": -0.5,
      "type": "output",
      "squash": "LOGISTIC",
      "index": 4,
    }],
    "synapses": [{
      "weight": 1.0,
      "from": 0,
      "to": 2,
    }, {
      "weight": 0.5,
      "from": 1,
      "to": 2,
    }, {
      "weight": -0.5,
      "from": 2,
      "to": 3,
    }, {
      "weight": 0.8,
      "from": 3,
      "to": 4,
    }],
    "input": 2,
    "output": 1,
  });

  creature.validate();
  const state = new CreatureState(creature);

  // Test setting and getting adjusted activation values using Map-like interface
  state.cacheAdjustedActivation.set(0, 0.5);
  state.cacheAdjustedActivation.set(1, 0.75);
  state.cacheAdjustedActivation.set(2, -0.3);
  state.cacheAdjustedActivation.set(3, 1.0);
  state.cacheAdjustedActivation.set(4, 0.0);

  // Verify values can be retrieved correctly
  assertAlmostEquals(
    state.cacheAdjustedActivation.get(0) as number,
    0.5,
    0.000001,
  );
  assertAlmostEquals(
    state.cacheAdjustedActivation.get(1) as number,
    0.75,
    0.000001,
  );
  assertAlmostEquals(
    state.cacheAdjustedActivation.get(2) as number,
    -0.3,
    0.000001,
  );
  assertAlmostEquals(
    state.cacheAdjustedActivation.get(3) as number,
    1.0,
    0.000001,
  );
  assertAlmostEquals(
    state.cacheAdjustedActivation.get(4) as number,
    0.0,
    0.000001,
  );

  // Test has method
  assertEquals(state.cacheAdjustedActivation.has(0), true);
  assertEquals(state.cacheAdjustedActivation.has(1), true);
  assertEquals(state.cacheAdjustedActivation.has(2), true);

  // Clear and verify
  state.cacheAdjustedActivation.clear();
  assertEquals(state.cacheAdjustedActivation.has(0), false);
  assertEquals(state.cacheAdjustedActivation.has(1), false);
});

Deno.test("CreatureState node() returns consistent NeuronState for same index", () => {
  const creature = Creature.fromJSON({
    "neurons": [{
      "bias": 0.1,
      "type": "hidden",
      "squash": "LOGISTIC",
      "index": 2,
    }, {
      "bias": 0.2,
      "type": "output",
      "squash": "LOGISTIC",
      "index": 3,
    }],
    "synapses": [{
      "weight": 1.0,
      "from": 0,
      "to": 2,
    }, {
      "weight": 0.5,
      "from": 2,
      "to": 3,
    }],
    "input": 2,
    "output": 1,
  });

  creature.validate();
  const state = new CreatureState(creature);

  // Get node state for index 2 twice
  const nodeState1 = state.node(2);
  const nodeState2 = state.node(2);

  // Should return the same object (or at least the same values)
  nodeState1.count = 5;
  nodeState1.totalBias = 0.5;
  nodeState1.hintValue = 0.123;

  assertEquals(nodeState2.count, 5);
  assertAlmostEquals(nodeState2.totalBias, 0.5, 0.000001);
  assertAlmostEquals(nodeState2.hintValue, 0.123, 0.000001);
});

Deno.test("CreatureState clear() resets node and connection state", () => {
  const creature = Creature.fromJSON({
    "neurons": [{
      "bias": 0.1,
      "type": "hidden",
      "squash": "LOGISTIC",
      "index": 2,
    }, {
      "bias": 0.2,
      "type": "output",
      "squash": "LOGISTIC",
      "index": 3,
    }],
    "synapses": [{
      "weight": 1.0,
      "from": 0,
      "to": 2,
    }, {
      "weight": 0.5,
      "from": 2,
      "to": 3,
    }],
    "input": 2,
    "output": 1,
  });

  creature.validate();
  const state = new CreatureState(creature);

  // Set some state
  const nodeState = state.node(2);
  nodeState.count = 10;
  nodeState.totalBias = 1.5;

  const connState = state.connection(0, 2);
  connState.count = 3;

  // Clear all state (note: cacheAdjustedActivation is cleared separately in propagation)
  state.clear();

  // Node state should be reset (new NeuronState created)
  const freshNodeState = state.node(2);
  assertEquals(freshNodeState.count, 0);
  assertAlmostEquals(freshNodeState.totalBias, 0, 0.000001);
});

Deno.test("DenseNumberMap clear() clears adjusted activation cache", () => {
  const creature = Creature.fromJSON({
    "neurons": [{
      "bias": 0.1,
      "type": "hidden",
      "squash": "LOGISTIC",
      "index": 2,
    }, {
      "bias": 0.2,
      "type": "output",
      "squash": "LOGISTIC",
      "index": 3,
    }],
    "synapses": [{
      "weight": 1.0,
      "from": 0,
      "to": 2,
    }, {
      "weight": 0.5,
      "from": 2,
      "to": 3,
    }],
    "input": 2,
    "output": 1,
  });

  creature.validate();
  const state = new CreatureState(creature);

  // Set adjusted activation
  state.cacheAdjustedActivation.set(2, 0.99);
  assertEquals(state.cacheAdjustedActivation.has(2), true);

  // Clear adjusted activation cache directly
  state.cacheAdjustedActivation.clear();
  assertEquals(state.cacheAdjustedActivation.has(2), false);
});

Deno.test("CreatureState preserves behaviour with large neuron count", () => {
  // Create a larger creature to test performance characteristics
  const neurons: {
    bias: number;
    type: "hidden" | "output";
    squash: string;
    index: number;
  }[] = [];
  const synapses: { weight: number; from: number; to: number }[] = [];
  const inputCount = 10;
  const hiddenCount = 50;
  const outputCount = 5;
  const totalNeurons = inputCount + hiddenCount + outputCount;

  // Add hidden neurons
  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      bias: Math.random() - 0.5,
      type: "hidden" as const,
      squash: "LOGISTIC",
      index: inputCount + i,
    });
  }

  // Add output neurons
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      bias: Math.random() - 0.5,
      type: "output" as const,
      squash: "LOGISTIC",
      index: inputCount + hiddenCount + i,
    });
  }

  // Create synapses - ensure every hidden neuron has at least one inward connection
  for (let i = 0; i < hiddenCount; i++) {
    // Connect from input (round-robin) to each hidden neuron
    synapses.push({
      weight: Math.random() - 0.5,
      from: i % inputCount,
      to: inputCount + i,
    });
  }

  // Connect hidden to output
  for (let i = 0; i < hiddenCount; i++) {
    synapses.push({
      weight: Math.random() - 0.5,
      from: inputCount + i,
      to: inputCount + hiddenCount + (i % outputCount),
    });
  }

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: inputCount,
    output: outputCount,
  });

  creature.validate();
  const state = new CreatureState(creature);

  // Set adjusted activations for all neurons
  for (let i = 0; i < totalNeurons; i++) {
    state.cacheAdjustedActivation.set(i, Math.random());
  }

  // Verify all can be read back
  for (let i = 0; i < totalNeurons; i++) {
    assertEquals(state.cacheAdjustedActivation.has(i), true);
    const value = state.cacheAdjustedActivation.get(i);
    assertEquals(typeof value, "number");
    assertEquals(Number.isNaN(value), false);
  }

  // Set node state for all non-input neurons
  for (let i = inputCount; i < totalNeurons; i++) {
    const nodeState = state.node(i);
    nodeState.count = i;
    nodeState.totalBias = i * 0.1;
    nodeState.hintValue = i * 0.01;
    nodeState.traceActivation(i * 0.5);
  }

  // Verify node state
  for (let i = inputCount; i < totalNeurons; i++) {
    const nodeState = state.node(i);
    assertEquals(nodeState.count, i);
    assertAlmostEquals(nodeState.totalBias, i * 0.1, 0.000001);
    assertAlmostEquals(nodeState.hintValue, i * 0.01, 0.000001);
  }
});

Deno.test("CreatureState activation array uses Float32Array", () => {
  const creature = Creature.fromJSON({
    "neurons": [{
      "bias": 0,
      "type": "hidden",
      "squash": "LOGISTIC",
      "index": 2,
    }, {
      "bias": 0,
      "type": "output",
      "squash": "LOGISTIC",
      "index": 3,
    }],
    "synapses": [{
      "weight": 1.0,
      "from": 0,
      "to": 2,
    }, {
      "weight": 0.5,
      "from": 2,
      "to": 3,
    }],
    "input": 2,
    "output": 1,
  });

  creature.validate();
  const state = new CreatureState(creature);

  // Make activations
  const inputArr = new Float32Array([0.5, -0.3]);
  state.makeActivation(inputArr, false);

  // Verify activations array is Float32Array
  assertEquals(state.activations instanceof Float32Array, true);
  assertEquals(state.activations.length, creature.neurons.length);
});

Deno.test("DenseNumberMap is used internally by CreatureState", () => {
  const creature = Creature.fromJSON({
    "neurons": [{
      "bias": 0,
      "type": "hidden",
      "squash": "LOGISTIC",
      "index": 2,
    }, {
      "bias": 0,
      "type": "output",
      "squash": "LOGISTIC",
      "index": 3,
    }],
    "synapses": [{
      "weight": 1.0,
      "from": 0,
      "to": 2,
    }, {
      "weight": 0.5,
      "from": 2,
      "to": 3,
    }],
    "input": 2,
    "output": 1,
  });

  creature.validate();
  const state = new CreatureState(creature);

  // Verify that cacheAdjustedActivation is a DenseNumberMap
  assertEquals(state.cacheAdjustedActivation instanceof DenseNumberMap, true);
});
