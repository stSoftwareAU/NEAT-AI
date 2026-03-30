import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Upgrade } from "@reconstruct/Upgrade.ts";

Deno.test("Creature.fromJSON normalises legacy nodes to neurons", () => {
  // Legacy format used "nodes" instead of "neurons"
  const legacyJSON = {
    input: 1,
    output: 1,
    nodes: [
      { uuid: "hidden-1", type: "hidden", squash: "LOGISTIC", bias: 0 },
      { uuid: "output-0", type: "output", squash: "LOGISTIC", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
    ],
  } as Record<string, unknown>;

  const creature = Creature.fromJSON(legacyJSON as never);
  assertEquals(
    creature.neurons.length,
    3,
    "Should have 3 neurons (input + hidden + output)",
  );
  assertEquals(creature.synapses.length, 2, "Should have 2 synapses");
  assertEquals(creature.output, 1);
});

Deno.test("Creature.fromJSON normalises legacy connections to synapses", () => {
  // Legacy format used "connections" instead of "synapses"
  const legacyJSON = {
    input: 1,
    output: 1,
    neurons: [
      { uuid: "hidden-1", type: "hidden", squash: "LOGISTIC", bias: 0 },
      { uuid: "output-0", type: "output", squash: "LOGISTIC", bias: 0 },
    ],
    connections: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
    ],
  } as Record<string, unknown>;

  const creature = Creature.fromJSON(legacyJSON as never);
  assertEquals(
    creature.neurons.length,
    3,
    "Should have 3 neurons (input + hidden + output)",
  );
  assertEquals(
    creature.synapses.length,
    2,
    "Should have 2 synapses from legacy connections",
  );
});

Deno.test("Upgrade.CRISPR normalises legacy nodes and connections", () => {
  const legacyCRISPR = {
    id: "test-crispr",
    mode: "append" as const,
    nodes: [
      { squash: "LOGISTIC", bias: 0.5 },
    ],
    connections: [
      { weight: 1.0 },
    ],
  } as Record<string, unknown>;

  const result = Upgrade.CRISPR(legacyCRISPR as never);

  assertEquals(result.mode, "append");
  assertEquals(
    result.neurons?.length,
    1,
    "Should have 1 neuron from legacy nodes",
  );
  assertEquals(
    result.synapses?.length,
    1,
    "Should have 1 synapse from legacy connections",
  );
});
