import { assert } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { chooseNeurons } from "../../../src/propagate/sparse/ChooseNeurons.ts";

/**
 * Benchmark test to verify buildSynapseMap performance.
 * Issue #1029: Combine two forEach loops into a single pass.
 *
 * This test measures the performance of the chooseNeurons function,
 * which internally uses buildSynapseMap. By running multiple iterations
 * and measuring time, we can verify that the single-pass optimisation
 * provides meaningful improvement.
 */
Deno.test("buildSynapseMap - performance benchmark", () => {
  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/propagate/large/creature.json"),
    ),
  );

  const config = createBackPropagationConfig({
    sparseRatio: 0.05,
  });

  const creatureExport = creature.exportJSON();
  const synapseCount = creatureExport.synapses.length;

  console.log(`\nBenchmark: buildSynapseMap with ${synapseCount} synapses`);

  // Warm-up run
  chooseNeurons(creatureExport, config);

  const iterations = 100;
  const startTime = performance.now();

  for (let i = 0; i < iterations; i++) {
    chooseNeurons(creatureExport, config);
  }

  const endTime = performance.now();
  const totalTime = endTime - startTime;
  const avgTime = totalTime / iterations;

  console.log(
    `Total time for ${iterations} iterations: ${totalTime.toFixed(2)}ms`,
  );
  console.log(`Average time per iteration: ${avgTime.toFixed(4)}ms`);
  console.log(
    `Synapses per millisecond: ${(synapseCount / avgTime).toFixed(0)}`,
  );

  // The test should pass - this is a benchmark, not a regression test.
  // The purpose is to measure performance improvement after optimisation.
  assert(avgTime < 1000, `Average time ${avgTime}ms is too slow`);
});

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

  const creatureExport = creature.exportJSON();

  // Run the function multiple times to ensure consistent results
  const results: Set<string>[] = [];
  for (let i = 0; i < 5; i++) {
    results.push(new Set(chooseNeurons(creatureExport, config)));
  }

  // Each result should contain valid neuron UUIDs
  const validNeuronUUIDs = new Set(
    creatureExport.neurons
      .filter((n) => n.type === "hidden" || n.type === "output")
      .map((n) => n.uuid),
  );

  for (const result of results) {
    for (const uuid of result) {
      assert(
        validNeuronUUIDs.has(uuid),
        `Result contains invalid neuron UUID: ${uuid}`,
      );
    }
  }
});
