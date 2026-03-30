import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { fix, mutate } from "@neuron/NeuronTopology.ts";
import { Mutation } from "@neat/Mutation.ts";
import { TopologyError } from "@errors/TopologyError.ts";

/** Helper: creates a creature with a hidden neuron for topology tests. */
function makeTopologyCreature(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "LOGISTIC", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.3 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.7 },
    ],
  };
  return Creature.fromJSON(json);
}

Deno.test("mutate - MOD_BIAS modifies the bias", () => {
  const creature = makeTopologyCreature();
  const hiddenNeuron = creature.neurons.find((n) => n.type === "hidden")!;
  // Mutate bias multiple times to increase chance of visible change
  let changed = false;
  for (let i = 0; i < 20; i++) {
    const beforeBias = hiddenNeuron.bias;
    mutate(hiddenNeuron, Mutation.MOD_BIAS.name);
    if (hiddenNeuron.bias !== beforeBias) {
      changed = true;
    }
  }

  // After 20 mutations, the bias should have changed at least once
  assert(changed, "Bias should change after multiple MOD_BIAS mutations");
  // Bias should still be finite
  assert(Number.isFinite(hiddenNeuron.bias));
});

Deno.test("mutate - MOD_SQUASH changes the squash function", () => {
  const creature = makeTopologyCreature();
  const hiddenNeuron = creature.neurons.find((n) => n.type === "hidden")!;
  const originalSquash = hiddenNeuron.squash;

  // Try multiple times since random pick might choose same squash
  let changed = false;
  for (let i = 0; i < 20; i++) {
    mutate(hiddenNeuron, Mutation.MOD_SQUASH.name);
    if (hiddenNeuron.squash !== originalSquash) {
      changed = true;
      break;
    }
  }

  assert(changed, "Squash should change after multiple MOD_SQUASH mutations");
  assert(hiddenNeuron.squash !== undefined, "Squash should be defined");
});

Deno.test("mutate - MOD_SQUASH works on output neurons", () => {
  const creature = makeTopologyCreature();
  const outputNeuron = creature.neurons.find((n) => n.id === -1)!;

  const result = mutate(outputNeuron, Mutation.MOD_SQUASH.name);
  assert(result, "Mutation should return true");
});

Deno.test("mutate - throws for input neurons", () => {
  const creature = makeTopologyCreature();
  const inputNeuron = creature.neurons[0]; // input

  assertThrows(
    () => mutate(inputNeuron, Mutation.MOD_BIAS.name),
    TopologyError,
    "wrong node type",
  );
});

Deno.test("mutate - throws for unknown method", () => {
  const creature = makeTopologyCreature();
  const hiddenNeuron = creature.neurons.find((n) => n.type === "hidden")!;

  assertThrows(
    () => mutate(hiddenNeuron, "UNKNOWN_METHOD"),
    TopologyError,
    "Unknown mutate method",
  );
});

Deno.test("mutate - throws for non-string method", () => {
  const creature = makeTopologyCreature();
  const hiddenNeuron = creature.neurons.find((n) => n.id === 5001)!;

  assertThrows(
    () => mutate(hiddenNeuron, 42 as unknown as string),
    TopologyError,
    "wrong type",
  );
});

Deno.test("mutate - MOD_SQUASH throws for constant neurons", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-1", bias: 1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "const-1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.3 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const constNeuron = creature.neurons.find((n) => n.type === "constant")!;

  assertThrows(
    () => mutate(constNeuron, Mutation.MOD_SQUASH.name),
    TopologyError,
    "constant",
  );
});

Deno.test("mutate - returns true on success", () => {
  const creature = makeTopologyCreature();
  const hiddenNeuron = creature.neurons.find((n) => n.type === "hidden")!;

  const result = mutate(hiddenNeuron, Mutation.MOD_BIAS.name);
  assertEquals(result, true);
});

Deno.test("mutate - clears creature UUID after mutation", () => {
  const creature = makeTopologyCreature();
  creature.uuid = "test-uuid";
  const hiddenNeuron = creature.neurons.find((n) => n.type === "hidden")!;

  mutate(hiddenNeuron, Mutation.MOD_BIAS.name);
  assertEquals(creature.uuid, undefined);
});

Deno.test("fix - hidden neuron gets inward connection if none", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "isolated-h", squash: "LOGISTIC", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // No inward connection to hidden, only outward
      { fromUUID: "isolated-h", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.3 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const hidden = creature.neurons.find((n) => n.type === "hidden")!;

  fix(hidden);

  // After fix, the hidden neuron should have at least one inward connection
  const inward = creature.inwardConnections(hidden.index);
  assert(
    inward.length > 0,
    "Hidden neuron should have inward connections after fix",
  );
});

Deno.test("fix - output neuron gets inward connection if none", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
  };
  const creature = Creature.fromJSON(json);
  const output = creature.neurons.find((n) => n.id === -1)!;

  fix(output);

  const inward = creature.inwardConnections(output.index);
  assert(
    inward.length > 0,
    "Output neuron should have inward connections after fix",
  );
});
