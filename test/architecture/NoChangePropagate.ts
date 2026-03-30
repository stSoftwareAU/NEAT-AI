/**
 * Unit tests for NoChangePropagate.
 *
 * Issue #1727: Tests for the recursive backpropagation "no-op" pass
 * that marks neurons as noChange when error is below plankConstant.
 *
 * Covers:
 * - Standard path propagation (non-NeuronActivationInterface squash)
 * - noChange = true short-circuit
 * - NeuronActivationInterface path (IF-branched network)
 */

import {
  assertEquals,
  assertGreaterOrEqual,
  assertLessOrEqual,
} from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { noChangePropagate } from "@architecture/NoChangePropagate.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";

/**
 * Create a simple creature with IDENTITY squash (standard path).
 * Topology: input-0 → hidden-0 → output-0
 *
 * IDENTITY does NOT implement NeuronActivationInterface.propagate,
 * so it takes the "else" branch in noChangePropagate.
 */
function makeIdentityCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.5 },
    ],
  });
  // Pre-populate activations and cache to avoid WASM dependency
  initState(creature);
  return creature;
}

/**
 * Create a creature with IF squash (NeuronActivationInterface path).
 * IF implements propagate(), so it takes the first branch.
 * Topology: input-0, input-1 → hidden-IF → output-0
 */
function makeIfCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-if", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-if",
        weight: 1,
        type: "condition",
      },
      {
        fromUUID: "input-1",
        toUUID: "hidden-if",
        weight: 1,
        type: "positive",
      },
      { fromUUID: "hidden-if", toUUID: "output-0", weight: 0.5 },
    ],
  });
  initState(creature);
  return creature;
}

/**
 * Initialise creature state without WASM activation.
 * Sets up activations and cacheAdjustedActivation for all neurons
 * so noChangePropagate's recursive calls to adjustedActivation() work.
 */
function initState(creature: Creature): void {
  const state = creature.state;
  // Allocate activations array
  state.activations = new Float32Array(creature.neurons.length);
  // Pre-populate cache with 0 for all neurons so adjustedActivation()
  // returns immediately without calling WASM-dependent code
  for (const neuron of creature.neurons) {
    state.cacheAdjustedActivation.set(neuron.index, 0);
  }
}

const config = createBackPropagationConfig({
  generations: 1,
  learningRate: 0.01,
  plankConstant: 0.000_000_1,
});

// --- Standard path (IDENTITY — no propagate method) ---

Deno.test("noChangePropagate - marks output neuron as noChange (standard path)", () => {
  const creature = makeIdentityCreature();
  const outputNeuron = creature.neurons[creature.neurons.length - 1];
  const ns = creature.state.node(outputNeuron.index);

  assertEquals(ns.noChange, undefined, "should not be noChange before call");

  noChangePropagate(outputNeuron, 0.5, config);

  assertEquals(ns.noChange, true, "should be noChange after call");
});

Deno.test("noChangePropagate - accumulates totalBias and count (standard path)", () => {
  const creature = makeIdentityCreature();
  const outputNeuron = creature.neurons[creature.neurons.length - 1];
  const ns = creature.state.node(outputNeuron.index);

  const initialCount = ns.count;
  const initialTotalBias = ns.totalBias;

  noChangePropagate(outputNeuron, 0.5, config);

  assertEquals(ns.count, initialCount + 1, "count should increment by 1");
  assertEquals(
    ns.totalBias,
    initialTotalBias + outputNeuron.bias,
    "totalBias should accumulate bias",
  );
});

Deno.test("noChangePropagate - traces activation value", () => {
  const creature = makeIdentityCreature();
  const outputNeuron = creature.neurons[creature.neurons.length - 1];
  const ns = creature.state.node(outputNeuron.index);

  noChangePropagate(outputNeuron, 0.75, config);

  // traceActivation updates min/max
  assertGreaterOrEqual(
    ns.maximumActivation,
    0.75,
    "maximumActivation should track traced value",
  );
  assertLessOrEqual(
    ns.minimumActivation,
    0.75,
    "minimumActivation should track traced value",
  );
});

Deno.test("noChangePropagate - recursively propagates to upstream hidden neurons (standard path)", () => {
  const creature = makeIdentityCreature();
  const outputNeuron = creature.neurons[creature.neurons.length - 1];
  const hiddenNeuron = creature.neurons.find((n) => n.id === 1775329651)!;
  const hiddenNS = creature.state.node(hiddenNeuron.index);

  assertEquals(
    hiddenNS.noChange,
    undefined,
    "hidden should not be noChange initially",
  );

  noChangePropagate(outputNeuron, 0.5, config);

  assertEquals(
    hiddenNS.noChange,
    true,
    "hidden neuron should be marked noChange via recursion",
  );
});

Deno.test("noChangePropagate - short-circuits when noChange already true", () => {
  const creature = makeIdentityCreature();
  const outputNeuron = creature.neurons[creature.neurons.length - 1];
  const hiddenNeuron = creature.neurons.find((n) => n.id === 1775329651)!;
  const hiddenNS = creature.state.node(hiddenNeuron.index);

  // Pre-mark hidden as noChange
  hiddenNS.noChange = true;
  const countBefore = hiddenNS.count;

  // Call on output — should recurse into hidden but short-circuit
  noChangePropagate(outputNeuron, 0.5, config);

  // Hidden neuron's count should NOT be incremented because it was already noChange
  // (the short-circuit prevents the standard path from running on it)
  assertEquals(
    hiddenNS.count,
    countBefore,
    "hidden neuron count should not change when already noChange",
  );
});

Deno.test("noChangePropagate - does not recurse into input neurons", () => {
  const creature = makeIdentityCreature();

  // Input neurons have type "input" — noChangePropagate skips them
  // Just verify it doesn't throw when the upstream is an input
  const hiddenNeuron = creature.neurons.find((n) => n.id === 1775329651)!;

  noChangePropagate(hiddenNeuron, 0.5, config);

  const hiddenNS = creature.state.node(hiddenNeuron.index);
  assertEquals(hiddenNS.noChange, true, "hidden should be marked noChange");
});

// --- NeuronActivationInterface path (IF squash) ---

Deno.test("noChangePropagate - IF neuron takes NeuronActivationInterface branch", () => {
  const creature = makeIfCreature();
  const ifNeuron = creature.neurons.find((n) => n.id === 831357536)!;
  const ns = creature.state.node(ifNeuron.index);

  assertEquals(ns.noChange, undefined, "should not be noChange before call");

  noChangePropagate(ifNeuron, 0.5, config);

  assertEquals(ns.noChange, true, "IF neuron should be marked noChange");
  // IF implements NeuronActivationInterface, so it takes the first branch.
  // The first branch does NOT increment count or accumulate totalBias.
  assertEquals(ns.count, 0, "count should not be incremented on IF path");
});

Deno.test("noChangePropagate - output with IF upstream recursively marks IF as noChange", () => {
  const creature = makeIfCreature();
  const outputNeuron = creature.neurons[creature.neurons.length - 1];
  const ifNeuron = creature.neurons.find((n) => n.id === 831357536)!;
  const ifNS = creature.state.node(ifNeuron.index);

  noChangePropagate(outputNeuron, 0.5, config);

  // Output neuron uses IDENTITY (standard path) — recurses to IF neuron
  assertEquals(
    ifNS.noChange,
    true,
    "IF neuron should be marked noChange via recursive call",
  );
});

// --- Multi-layer chain ---

Deno.test("noChangePropagate - propagates through multi-layer chain", () => {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 1 },
      { fromUUID: "h1", toUUID: "h2", weight: 1 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1 },
    ],
  });
  initState(creature);

  const outNeuron = creature.neurons[creature.neurons.length - 1];
  const h1 = creature.neurons.find((n) => n.id === 1003273)!;
  const h2 = creature.neurons.find((n) => n.id === 1003274)!;

  noChangePropagate(outNeuron, 0.5, config);

  assertEquals(
    creature.state.node(outNeuron.index).noChange,
    true,
    "output should be noChange",
  );
  assertEquals(
    creature.state.node(h2.index).noChange,
    true,
    "h2 should be noChange",
  );
  assertEquals(
    creature.state.node(h1.index).noChange,
    true,
    "h1 should be noChange",
  );
});
