import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { buildOutgoingSynapsesMap } from "../../../src/propagate/sparse/CalculatePathsToOutput.ts";
import { SparseConfig } from "../../../src/propagate/sparse/SparseConfig.ts";

Deno.test("SparseConfig with cached outgoing map produces consistent results", () => {
  const creature = makeCreature();
  const json = creature.exportJSON();
  const config = createBackPropagationConfig({ sparseRatio: 1 });

  // Create without cache
  const sparseWithout = new SparseConfig(json, config);

  // Create with cached outgoing map
  const cachedMap = buildOutgoingSynapsesMap(json);
  const sparseWith = new SparseConfig(json, config, cachedMap);

  // With sparseRatio=1, all hidden+output neurons are selected.
  // Both should agree on propagateNeeded for all neurons.
  for (const neuron of json.neurons) {
    assertEquals(
      sparseWith.propagateNeeded(neuron.uuid),
      sparseWithout.propagateNeeded(neuron.uuid),
      `propagateNeeded differs for ${neuron.uuid}`,
    );
    assertEquals(
      sparseWith.traceNeeded(neuron.uuid),
      sparseWithout.traceNeeded(neuron.uuid),
      `traceNeeded differs for ${neuron.uuid}`,
    );
    assertEquals(
      sparseWith.updateNeeded(neuron.uuid),
      sparseWithout.updateNeeded(neuron.uuid),
      `updateNeeded differs for ${neuron.uuid}`,
    );
  }
});

Deno.test("SparseConfig cached outgoing map reusable across multiple configs", () => {
  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/propagate/large/creature.json"),
    ),
  );
  const json = creature.exportJSON();

  // Build the outgoing synapse map once
  const cachedMap = buildOutgoingSynapsesMap(json);

  // Use it with different sparse ratios
  const config1 = createBackPropagationConfig({ sparseRatio: 1 });
  const config2 = createBackPropagationConfig({ sparseRatio: 1 });

  const sparse1 = new SparseConfig(json, config1, cachedMap);
  const sparse2 = new SparseConfig(json, config2, cachedMap);

  // With sparseRatio=1, all neurons are selected - both should agree
  for (const neuron of json.neurons) {
    assertEquals(
      sparse1.propagateNeeded(neuron.uuid),
      sparse2.propagateNeeded(neuron.uuid),
      `propagateNeeded differs for ${neuron.uuid}`,
    );
  }
});

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", squash: "Cosine", uuid: "hidden-0", bias: -0.1 },
      { type: "hidden", squash: "ABSOLUTE", uuid: "hidden-1", bias: 0.2 },
      { type: "hidden", squash: "BENT_IDENTITY", uuid: "hidden-2", bias: -0.2 },
      {
        type: "hidden",
        squash: "BIPOLAR_SIGMOID",
        uuid: "hidden-3",
        bias: 0.3,
      },
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0.1 },
      { type: "output", squash: "TANH", uuid: "output-1", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: -0.3 },
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 0.3 },
      { fromUUID: "hidden-2", toUUID: "hidden-3", weight: 0.4 },
      { fromUUID: "hidden-3", toUUID: "output-0", weight: -0.5 },
      { fromUUID: "hidden-3", toUUID: "output-1", weight: 0.6 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.1 },
    ],
    input: 1,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}
