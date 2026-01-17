/**
 * Benchmark for issue #1094: Reuse Float32Array in activate() instead of creating new wrapper
 *
 * This benchmark measures:
 * 1. Activation speed improvement with buffer reuse
 * 2. Memory allocation reduction (via GC pressure proxy metrics)
 * 3. Performance with varying creature sizes
 *
 * Requirements from issue:
 * - Measure activation calls on creatures with varying sizes
 * - Profile performance difference between buffer reuse and new allocation
 * - Expected improvement: 5-15% for repeated activations
 *
 * Run with: deno bench bench/ActivateBufferReuse.ts
 */
import { Creature } from "../src/Creature.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = false;

/**
 * Creates a creature with the specified number of inputs, outputs, and hidden neurons.
 */
function createCreature(
  inputCount: number,
  outputCount: number,
  hiddenNeurons: number,
): Creature {
  // Create neurons array
  const neurons: {
    type: "hidden" | "output";
    uuid: string;
    bias: number;
    squash: string;
  }[] = [];
  const synapses: { fromUUID: string; toUUID: string; weight: number }[] = [];

  // Add hidden neurons
  for (let i = 0; i < hiddenNeurons; i++) {
    neurons.push({
      type: "hidden",
      uuid: `hidden-${i}`,
      bias: Math.random() * 0.2 - 0.1,
      squash: "LOGISTIC",
    });
    // Connect from input to hidden
    synapses.push({
      fromUUID: `input-${i % inputCount}`,
      toUUID: `hidden-${i}`,
      weight: Math.random() * 2 - 1,
    });
  }

  // Add output neurons
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      bias: Math.random() * 0.2 - 0.1,
      squash: "IDENTITY",
    });
    // Connect from hidden to output (if we have hidden neurons)
    if (hiddenNeurons > 0) {
      synapses.push({
        fromUUID: `hidden-${i % hiddenNeurons}`,
        toUUID: `output-${i}`,
        weight: Math.random() * 2 - 1,
      });
    } else {
      // Connect directly from input to output
      synapses.push({
        fromUUID: `input-${i % inputCount}`,
        toUUID: `output-${i}`,
        weight: Math.random() * 2 - 1,
      });
    }
  }

  return Creature.fromJSON({
    input: inputCount,
    output: outputCount,
    neurons,
    synapses,
  });
}

// Pre-create creatures for benchmarks to avoid creation time affecting results
const smallCreature = createCreature(10, 100, 50);
const mediumCreature = createCreature(20, 50, 150);
const largeCreature = createCreature(30, 100, 300);

// Create input arrays
const smallInput = new Float32Array(smallCreature.input);
for (let i = 0; i < smallCreature.input; i++) {
  smallInput[i] = Math.random();
}

const mediumInput = new Float32Array(mediumCreature.input);
for (let i = 0; i < mediumCreature.input; i++) {
  mediumInput[i] = Math.random();
}

const largeInput = new Float32Array(largeCreature.input);
for (let i = 0; i < largeCreature.input; i++) {
  largeInput[i] = Math.random();
}

// Warm up creatures
for (let i = 0; i < 100; i++) {
  smallCreature.activate(smallInput, false, false);
  mediumCreature.activate(mediumInput, false, false);
  largeCreature.activate(largeInput, false, false);
}

/**
 * Benchmark: Small creature (160 neurons) - new buffer each call
 */
Deno.bench("activate: small creature (160 neurons) - new buffer", () => {
  smallCreature.activate(smallInput, false, false);
});

/**
 * Benchmark: Small creature (160 neurons) - reuse buffer
 */
Deno.bench("activate: small creature (160 neurons) - reuse buffer", () => {
  smallCreature.activate(smallInput, false, true);
});

/**
 * Benchmark: Medium creature (220 neurons) - new buffer each call
 */
Deno.bench("activate: medium creature (220 neurons) - new buffer", () => {
  mediumCreature.activate(mediumInput, false, false);
});

/**
 * Benchmark: Medium creature (220 neurons) - reuse buffer
 */
Deno.bench("activate: medium creature (220 neurons) - reuse buffer", () => {
  mediumCreature.activate(mediumInput, false, true);
});

/**
 * Benchmark: Large creature (430 neurons) - new buffer each call
 */
Deno.bench("activate: large creature (430 neurons) - new buffer", () => {
  largeCreature.activate(largeInput, false, false);
});

/**
 * Benchmark: Large creature (430 neurons) - reuse buffer
 */
Deno.bench("activate: large creature (430 neurons) - reuse buffer", () => {
  largeCreature.activate(largeInput, false, true);
});
