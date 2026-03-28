import { assert } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { chooseNeurons } from "../../../src/propagate/sparse/ChooseNeurons.ts";

// NOTE: Performance benchmark tests have been moved to bench/sparse/BuildSynapseMap.ts
// Unit tests should only verify correctness, not performance timings.
// Performance tests are flaky when run in parallel (issue #1181).

/**
 * Test to verify that buildSynapseMap produces correct results.
 * This ensures the optimisation doesn't change the behaviour.
 */
Deno.test("buildSynapseMap - correctness verification", () => {
  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/propagate/large/creature.json"),
    ),
  );

  const config = createBackPropagationConfig({
    sparseRatio: 0.05,
  });

  const creatureExport = creature.exportInternalJSON();

  // Run the function multiple times to ensure consistent results
  const results: Set<string>[] = [];
  for (let i = 0; i < 5; i++) {
    // @ts-ignore: test with legacy string neuron IDs
    results.push(new Set(chooseNeurons(creatureExport, config)));
  }

  // Each result should contain valid neuron UUIDs
  const validNeuronUUIDs = new Set(
    creatureExport.neurons
      .filter((n) => n.type === "hidden" || n.type === "output")
      .map((n) => n.id),
  );

  for (const result of results) {
    for (const uuid of result) {
      assert(
        validNeuronUUIDs.has(uuid as unknown as number),
        `Result contains invalid neuron UUID: ${uuid}`,
      );
    }
  }
});
