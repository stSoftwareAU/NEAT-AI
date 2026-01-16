/**
 * Benchmark for AddNeuron focus selection optimisation (Issue #1018).
 *
 * This benchmark measures the performance improvement from using direct
 * selection from valid candidates instead of rejection-based sampling.
 */
import { Creature } from "../../src/Creature.ts";
import { AddNeuron } from "../../src/mutate/AddNeuron.ts";

/**
 * Creates a large network for performance benchmarking.
 */
function createBenchmarkNetwork(inputCount: number, hiddenCount: number) {
  const neurons = [];
  const synapses = [];

  // Add input neurons
  for (let i = 0; i < inputCount; i++) {
    neurons.push({ type: "input" as const, index: i });
  }

  // Add hidden neurons
  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      type: "hidden" as const,
      index: inputCount + i,
      bias: Math.random() * 0.2 - 0.1,
      squash: "LOGISTIC" as const,
    });
  }

  // Add output neuron
  const outputIndex = inputCount + hiddenCount;
  neurons.push({
    type: "output" as const,
    index: outputIndex,
    bias: 0.1,
    squash: "LOGISTIC" as const,
  });

  // Connect inputs to first hidden
  for (let i = 0; i < inputCount; i++) {
    synapses.push({
      from: i,
      to: inputCount,
      weight: Math.random(),
    });
  }

  // Chain hidden neurons
  for (let i = 0; i < hiddenCount - 1; i++) {
    synapses.push({
      from: inputCount + i,
      to: inputCount + i + 1,
      weight: Math.random(),
    });
  }

  // Connect last hidden to output
  synapses.push({
    from: inputCount + hiddenCount - 1,
    to: outputIndex,
    weight: Math.random(),
  });

  return {
    neurons,
    synapses,
    input: inputCount,
    output: 1,
  };
}

Deno.test("AddNeuron - benchmark focus selection performance", () => {
  // Create a moderately sized network
  const inputCount = 20;
  const hiddenCount = 50;
  const networkDef = createBenchmarkNetwork(inputCount, hiddenCount);

  // Small focus list relative to network size (worst case for rejection sampling)
  const focusList = [0, 1, 2]; // Only 3 out of 20 inputs

  const iterations = 100;

  // Benchmark with focus list
  const startWithFocus = performance.now();
  for (let i = 0; i < iterations; i++) {
    const creature = Creature.fromJSON(networkDef);
    const addNeuron = new AddNeuron(creature);
    addNeuron.mutate(focusList);
  }
  const endWithFocus = performance.now();
  const timeWithFocus = endWithFocus - startWithFocus;

  // Benchmark without focus list (baseline)
  const startNoFocus = performance.now();
  for (let i = 0; i < iterations; i++) {
    const creature = Creature.fromJSON(networkDef);
    const addNeuron = new AddNeuron(creature);
    addNeuron.mutate();
  }
  const endNoFocus = performance.now();
  const timeNoFocus = endNoFocus - startNoFocus;

  console.log(`\nAddNeuron benchmark (${iterations} iterations):`);
  console.log(
    `  With focus list (${focusList.length} items): ${
      timeWithFocus.toFixed(2)
    }ms`,
  );
  console.log(`  Without focus list: ${timeNoFocus.toFixed(2)}ms`);
  console.log(
    `  Ratio (focus/no-focus): ${(timeWithFocus / timeNoFocus).toFixed(2)}x`,
  );

  // The optimised implementation should make focus list performance
  // comparable to no-focus performance (within 2x)
  // The old rejection-based approach could be much slower
});

Deno.test("AddNeuron - benchmark large network with very restrictive focus", () => {
  // Create a large network
  const inputCount = 50;
  const hiddenCount = 100;
  const networkDef = createBenchmarkNetwork(inputCount, hiddenCount);

  // Very restrictive focus list (worst case for rejection sampling)
  const focusList = [0]; // Only 1 out of 50 inputs

  const iterations = 50;

  const start = performance.now();
  let successCount = 0;
  for (let i = 0; i < iterations; i++) {
    const creature = Creature.fromJSON(networkDef);
    const addNeuron = new AddNeuron(creature);
    if (addNeuron.mutate(focusList)) {
      successCount++;
    }
  }
  const end = performance.now();
  const totalTime = end - start;

  console.log(`\nLarge network benchmark (${iterations} iterations):`);
  console.log(
    `  Network size: ${inputCount} inputs, ${hiddenCount} hidden neurons`,
  );
  console.log(`  Focus list size: ${focusList.length}`);
  console.log(`  Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`  Per-mutation: ${(totalTime / iterations).toFixed(2)}ms`);
  console.log(
    `  Success rate: ${(successCount / iterations * 100).toFixed(1)}%`,
  );
});
